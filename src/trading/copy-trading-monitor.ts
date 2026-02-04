import { AccountMonitor } from '../monitor/account-monitor';
import { PolymarketClient } from '../api/polymarket-client';
import { TradeExecutor } from './trade-executor';
import {
  Position,
  TradingStatus,
  MonitorOptions,
  CopyTradingConfig,
  CopyTradingStatus
} from '../types';

/**
 * Copy Trading Monitor
 * Wraps AccountMonitor and executes trades to copy the target account's positions
 */
export class CopyTradingMonitor {
  private accountMonitor: AccountMonitor;
  private tradeExecutor: TradeExecutor;
  private config: CopyTradingConfig;
  private stats: CopyTradingStatus;
  private executedPositions: Set<string> = new Set();
  private targetPositions: Map<string, Position> = new Map();
  private targetAddress: string;

  // 🔒 Prevent overlapping status updates
  private isProcessingUpdate = false;

  constructor(
    client: PolymarketClient,
    monitorOptions: MonitorOptions,
    copyTradingConfig: CopyTradingConfig
  ) {
    this.config = copyTradingConfig;
    this.targetAddress = monitorOptions.targetAddress;

    this.tradeExecutor = new TradeExecutor(copyTradingConfig);

    this.stats = {
      enabled: copyTradingConfig.enabled,
      dryRun: copyTradingConfig.dryRun ?? false,
      totalTradesExecuted: 0,
      totalTradesFailed: 0,
      totalVolume: '0',
    };

    this.accountMonitor = new AccountMonitor(client, {
      ...monitorOptions,
      onUpdate: (status: TradingStatus) => {
        monitorOptions.onUpdate?.(status);

        if (this.config.enabled) {
          this.handleStatusUpdate(status);
        }
      },
      onError: (error: Error) => {
        monitorOptions.onError?.(error);
        console.error('Copy trading monitor error:', error);
      },
    });
  }

  async start(): Promise<void> {
    if (!this.config.enabled) {
      console.log('⚠️  Copy trading is disabled. Starting monitor only...');
      await this.accountMonitor.start();
      return;
    }

    console.log('🚀 Starting copy trading monitor...');
    console.log(`📊 Target address: ${this.targetAddress}`);
    console.log(`👛 Trading wallet: ${this.tradeExecutor.getWalletAddress()}`);
    console.log(this.config.dryRun ? '🔍 DRY RUN MODE' : '✅ LIVE MODE');

    try {
      await this.tradeExecutor.initialize();
    } catch (error: any) {
      console.error('Failed to initialize trade executor:', error.message);
      if (!this.config.dryRun) throw error;
    }

    await this.accountMonitor.start();
    console.log('✅ Copy trading monitor started');
  }

  stop(): void {
    this.accountMonitor.stop();
    console.log('🛑 Copy trading monitor stopped');
  }

  private async handleStatusUpdate(status: TradingStatus): Promise<void> {
    if (this.isProcessingUpdate) return;
    this.isProcessingUpdate = true;

    try {
      const currentPositions = new Map<string, Position>();
      status.openPositions.forEach(pos => currentPositions.set(pos.id, pos));

      const newPositions: Position[] = [];
      const closedPositions: Position[] = [];

      for (const [id, pos] of currentPositions) {
        if (!this.targetPositions.has(id)) newPositions.push(pos);
      }

      for (const [id, pos] of this.targetPositions) {
        if (!currentPositions.has(id)) closedPositions.push(pos);
      }

      for (const position of newPositions) {
        if (this.executedPositions.has(position.id)) continue;

        try {
          console.log(`\n🆕 New position: ${position.market.question}`);
          const result = await this.tradeExecutor.executeBuy(position);

          if (result.success) {
            this.executedPositions.add(position.id);
            this.stats.totalTradesExecuted++;

            const qty = Number(result.executedQuantity) || 0;
            const price = Number(result.executedPrice) || 0;
            const tradeValue = qty * price;

            this.stats.totalVolume = (
              Number(this.stats.totalVolume) + tradeValue
            ).toFixed(2);

            this.stats.lastTradeTime = new Date().toISOString();
          } else {
            this.stats.totalTradesFailed++;
            console.error('Buy failed:', result.error);
          }
        } catch (error: any) {
          this.stats.totalTradesFailed++;
          console.error('Buy error:', error.message);
        }
      }

      for (const position of closedPositions) {
        if (!this.executedPositions.has(position.id)) continue;

        try {
          console.log(`\n❌ Position closed: ${position.market.question}`);
          const result = await this.tradeExecutor.executeSell(position);

          if (result.success) {
            this.executedPositions.delete(position.id);
            this.stats.totalTradesExecuted++;

            const qty = Number(result.executedQuantity) || 0;
            const price = Number(result.executedPrice) || 0;
            const tradeValue = qty * price;

            this.stats.totalVolume = (
              Number(this.stats.totalVolume) + tradeValue
            ).toFixed(2);

            this.stats.lastTradeTime = new Date().toISOString();
          } else {
            this.stats.totalTradesFailed++;
            console.error('Sell failed:', result.error);
          }
        } catch (error: any) {
          this.stats.totalTradesFailed++;
          console.error('Sell error:', error.message);
        }
      }

      this.targetPositions = currentPositions;
    } finally {
      this.isProcessingUpdate = false;
    }
  }

  getStats(): CopyTradingStatus {
    return { ...this.stats };
  }

  isRunning(): boolean {
    return this.accountMonitor.isRunning();
  }

  getAccountMonitor(): AccountMonitor {
    return this.accountMonitor;
  }

  getTradeExecutor(): TradeExecutor {
    return this.tradeExecutor;
  }
}
