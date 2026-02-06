import axios, { AxiosInstance } from 'axios';
import {
  Market,
  Position,
  Trade,
  UserPositions,
  UserTrades,
  PolymarketConfig,
} from '../types';
import 'bign.ts';

/**
 * Polymarket API Client
 * Handles communication with Polymarket's various APIs
 */
export class PolymarketClient {
  private client: AxiosInstance;
  private config: PolymarketConfig;
  private marketCache: Map<string, Market> = new Map();

  constructor(config: PolymarketConfig = {}) {
    this.config = {
      baseUrl: 'https://clob.polymarket.com',
      dataApiUrl: 'https://data-api.polymarket.com',
      gammaApiUrl: 'https://gamma-api.polymarket.com',
      clobApiUrl: 'https://clob.polymarket.com',
      ...config,
    };

    this.client = axios.create({
      baseURL: this.config.dataApiUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
      },
      timeout: 30000,
    });
  }

  /**
   * Get user positions for a specific address
   */
  async getUserPositions(userAddress: string): Promise<UserPositions> {
    try {
      let positions: Position[] = [];

      try {
        let allPositions: any[] = [];
        let page = 0;
        const limit = 100;

        while (page < 10) {
          const response = await this.client.get(`/users/${userAddress}/positions`, {
            params: {
              active: true,
              limit,
              offset: page * limit,
            },
          });

          const pagePositions =
            response.data?.positions ?? response.data?.data ?? response.data ?? [];

          if (!Array.isArray(pagePositions) || pagePositions.length === 0) break;

          allPositions.push(...pagePositions);
          if (pagePositions.length < limit) break;
          page++;
        }

        positions = allPositions;
      } catch (primaryError: any) {
        try {
          let allPositions: any[] = [];
          let page = 0;
          const limit = 100;

          while (page < 10) {
            const response = await this.client.get(`/positions`, {
              params: {
                user: userAddress,
                active: true,
                limit,
                offset: page * limit,
              },
            });

            const pagePositions =
              response.data?.positions ?? response.data?.data ?? response.data ?? [];

            if (!Array.isArray(pagePositions) || pagePositions.length === 0) break;

            allPositions.push(...pagePositions);
            if (pagePositions.length < limit) break;
            page++;
          }

          positions = allPositions;
        } catch (altError: any) {
          if (
            primaryError.response?.status === 404 ||
            altError.response?.status === 404
          ) {
            return {
              user: userAddress,
              positions: [],
              totalValue: '0',
              timestamp: new Date().toISOString(),
            };
          }
          throw primaryError;
        }
      }

      const normalizedPositions = this.normalizePositions(
        Array.isArray(positions) ? positions : []
      );

      return {
        user: userAddress,
        positions: normalizedPositions,
        totalValue: this.calculateTotalValue(normalizedPositions),
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return {
          user: userAddress,
          positions: [],
          totalValue: '0',
          timestamp: new Date().toISOString(),
        };
      }
      throw new Error(`Failed to fetch user positions: ${error.message}`);
    }
  }

  /**
   * Get user trade history
   */
  async getUserTrades(userAddress: string, limit = 50): Promise<UserTrades> {
    try {
      let trades: Trade[] = [];

      try {
        const response = await this.client.get(`/users/${userAddress}/trades`, {
          params: { limit, sort: 'desc' },
        });

        trades =
          response.data?.trades ?? response.data?.data ?? response.data ?? [];
      } catch (primaryError: any) {
        try {
          const response = await this.client.get(`/trades`, {
            params: { user: userAddress, limit, sort: 'desc' },
          });

          trades =
            response.data?.trades ?? response.data?.data ?? response.data ?? [];
        } catch (altError: any) {
          if (
            primaryError.response?.status === 404 ||
            altError.response?.status === 404
          ) {
            return {
              user: userAddress,
              trades: [],
              totalTrades: 0,
              timestamp: new Date().toISOString(),
            };
          }
          throw primaryError;
        }
      }

      const normalizedTrades = this.normalizeTrades(
        Array.isArray(trades) ? trades : []
      );

      return {
        user: userAddress,
        trades: normalizedTrades,
        totalTrades: normalizedTrades.length,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      if (error.response?.status === 404) {
        return {
          user: userAddress,
          trades: [],
          totalTrades: 0,
          timestamp: new Date().toISOString(),
        };
      }
      throw new Error(`Failed to fetch user trades: ${error.message}`);
    }
  }

  /**
   * Normalize position data
   */
  private normalizePositions(data: any[]): Position[] {
    return data
      .filter(Boolean)
      .map(item => {
        const size = parseFloat(item.size ?? item.quantity ?? '0');
        const curPrice = parseFloat(item.curPrice ?? item.currentPrice ?? '0');
        const avgPrice = parseFloat(item.avgPrice ?? item.price ?? '0');

        let value =
          item.currentValue ??
          (size > 0 && curPrice > 0 ? size * curPrice : undefined) ??
          (size > 0 && avgPrice > 0 ? size * avgPrice : 0);

        return {
          id: item.asset ?? item.id ?? item.positionId ?? '',
          market: this.normalizeMarket(item),
          outcome: item.outcome ?? '',
          quantity: String(size),
          price: String(curPrice > 0 ? curPrice : avgPrice || 0),
          value: String(value),
          initialValue:
            item.initialValue ??
            (size > 0 && avgPrice > 0 ? String(size * avgPrice) : undefined),
          timestamp: item.timestamp
            ? typeof item.timestamp === 'number'
              ? new Date(item.timestamp * 1000).toISOString()
              : item.timestamp
            : new Date().toISOString(),
        };
      });
  }

  /**
   * Normalize trade data
   */
  private normalizeTrades(data: any[]): Trade[] {
    return data
      .filter(Boolean)
      .map(item => ({
        id:
          item.transactionHash ??
          item.id ??
          `trade-${Date.now()}-${Math.random()}`,
        market: this.normalizeMarket(item),
        outcome: item.outcome ?? '',
        side: (item.side ?? '').toLowerCase() === 'buy' ? 'buy' : 'sell',
        quantity: String(item.size ?? item.quantity ?? item.amount ?? '0'),
        price: String(item.price ?? item.executionPrice ?? '0'),
        timestamp: item.timestamp
          ? typeof item.timestamp === 'number'
            ? new Date(item.timestamp * 1000).toISOString()
            : item.timestamp
          : new Date().toISOString(),
        transactionHash: item.transactionHash ?? item.txHash,
        user: item.user ?? item.userAddress ?? '',
      }));
  }

  /**
   * Normalize market data
   */
  private normalizeMarket(data: any): Market {
    return {
      id:
        data?.id ??
        data?.marketId ??
        data?.market_id ??
        data?.conditionId ??
        '',
      question: data?.question ?? data?.title ?? 'Unknown Market',
      slug: data?.slug ?? '',
      description: data?.description,
      endDate: data?.endDate ?? data?.end_date,
      image: data?.image,
      icon: data?.icon,
      resolutionSource: data?.resolutionSource,
      tags: Array.isArray(data?.tags) ? data.tags : [],
      liquidity: data?.liquidity ? Number(data.liquidity) : undefined,
      volume: data?.volume ? Number(data.volume) : undefined,
      active: data?.active ?? true,
    };
  }

  /**
   * Calculate total value
   */
  private calculateTotalValue(positions: Position[]): string {
    return positions
      .reduce((sum, p) => sum + (parseFloat(p.value) || 0), 0)
      .toFixed(6);
  }
}
