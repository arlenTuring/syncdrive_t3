import { Controller, Get, Post, Body, Query, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody } from '@nestjs/swagger';
import { DatasourceService } from './datasource.service';
import { DashboardDemoSeedService } from '../database/dashboard-demo-seed.service';

@ApiTags('Datasource')
@Controller('syncdrive-api/datasource')
export class DatasourceController {
  constructor(
    private readonly datasourceService: DatasourceService,
    private readonly dashboardDemoSeed: DashboardDemoSeedService,
  ) {}

  /** 連線測試 */
  @Get('ping')
  @ApiOperation({ summary: '測試後端資料庫連線狀態' })
  async ping() {
    return this.datasourceService.ping();
  }

  /** 取得所有資料表 */
  @Get('tables')
  @ApiOperation({ summary: '取得 public schema 下所有資料表清單' })
  async getTables() {
    const tables = await this.datasourceService.getTables();
    return { tables: tables.map(t => t.table_name) };
  }

  /** 取得資料表欄位結構 */
  @Get('schema')
  @ApiOperation({ summary: '取得指定資料表的欄位結構' })
  async getSchema(@Query('table') table: string) {
    if (!table) throw new BadRequestException('table parameter is required');
    return this.datasourceService.getTableSchema(table);
  }

  /** 執行 SELECT 查詢 */
  @Post('query')
  @ApiOperation({ summary: '執行 SELECT 查詢並回傳結果（限 SELECT）' })
  @ApiBody({
    schema: {
      example: {
        query: 'SELECT vehicle_code, speed_kmh, created_at FROM telemetry_logs ORDER BY created_at DESC',
        limit: 100,
      },
    },
  })
  async runQuery(@Body() body: { query: string; limit?: number }) {
    if (!body?.query) throw new BadRequestException('query is required');
    return this.datasourceService.runQuery(body.query, body.limit ?? 200);
  }

  /** 寫入事件中心／班次中心示範資料（可重複執行） */
  @Post('seed-panels')
  @ApiOperation({ summary: '載入儀表板事件／班次示範資料到資料庫' })
  async seedPanels() {
    return this.dashboardDemoSeed.reseedPanels();
  }

  /** 寫入 11 台 PMS 車輛與調度訂單（車輛狀態列，可重複執行） */
  @Post('seed-vehicles')
  @ApiOperation({ summary: '載入儀表板 PMS 車輛與調度訂單示範資料' })
  async seedVehicles() {
    return this.dashboardDemoSeed.reseedVehicles();
  }

  /** 一次載入儀表板全部示範 SQL 種子 */
  @Post('seed-dashboard')
  @ApiOperation({ summary: '載入儀表板全部示範資料（車輛 + 事件 + 運能 + 整備）' })
  async seedDashboard() {
    return this.dashboardDemoSeed.reseedAll();
  }
}
