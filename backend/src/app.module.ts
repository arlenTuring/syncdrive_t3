import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MqttModule } from './mqtt/mqtt.module';
import { RedisModule } from './redis/redis.module';
import { EventsModule } from './events/events.module';
import { OperatingDayModule } from './operating-day/operating-day.module';
import { PartnerApiKey } from './database/entities/partner-api-key.entity';
import { PartnerAccessModule } from './partner-access/partner-access.module';
import { Vehicle } from './database/entities/vehicle.entity';
import { OperationOrder } from './database/entities/operation-order.entity';
import { CommandLog } from './database/entities/command-log.entity';
import { SecurityEventLog } from './database/entities/security-event-log.entity';
import { TelemetryLog } from './database/entities/telemetry-log.entity';
import { OperatorActionLog } from './database/entities/operator-action-log.entity';
import { SpeedLimitConfig } from './database/entities/speed-limit-config.entity';
import { JunctionInterlockLog } from './database/entities/junction-interlock-log.entity';
import { FieldEquipmentStatus } from './database/entities/field-equipment-status.entity';
import { FacilitySlot } from './database/entities/facility-slot.entity';
import { SlotStatus_ } from './database/entities/slot-status.entity';
import { CapacityTrendDemoPoint } from './database/entities/capacity-trend-demo-point.entity';
import { OperationRoute } from './database/entities/operation-route.entity';
import { OperationRouteStation } from './database/entities/operation-route-station.entity';
import { OperationRouteStationAction } from './database/entities/operation-route-station-action.entity';
import { OrderActionState } from './database/entities/order-action-state.entity';
import { OrderEvent } from './database/entities/order-event.entity';
import { TimeTemplate } from './database/entities/time-template.entity';
import { MaintenanceTask } from './database/entities/maintenance-task.entity';
import { OperationShift } from './database/entities/operation-shift.entity';
import { MediaLibraryItem } from './database/entities/media-library-item.entity';
// 後勤管理層（權限、日誌、系統基礎）——依第02584K章 2.2.3 規劃建立
import { Account } from './database/entities/account.entity';
import { Role } from './database/entities/role.entity';
import { Permission } from './database/entities/permission.entity';
import { RolePermission } from './database/entities/role-permission.entity';
import { AccountRole } from './database/entities/account-role.entity';
import { LoginLog } from './database/entities/login-log.entity';
import { PermissionChangeLog } from './database/entities/permission-change-log.entity';
import { SystemSetting } from './database/entities/system-setting.entity';
import { Notification } from './database/entities/notification.entity';
// 營運全景圖台版面——原僅存於瀏覽器 localStorage，改為伺服器端保存
import { DashboardPlane } from './database/entities/dashboard-plane.entity';
// 場域圖資與媒體排程——原僅存於瀏覽器 localStorage 或伺服器端 JSON 檔
import { MapEntity } from './database/entities/map.entity';
import { MapVersion } from './database/entities/map-version.entity';
import { MediaSchedule } from './database/entities/media-schedule.entity';
// 原僅存於瀏覽器 localStorage 的系統資產與流程狀態
import { DataSource_ } from './database/entities/data-source.entity';
import { VehicleDefinition } from './database/entities/vehicle-definition.entity';
import { ModuleDashboardPage } from './database/entities/module-dashboard-page.entity';
import { ScheduleAdjustRequest } from './database/entities/schedule-adjust-request.entity';
import { OrderModule } from './order/order.module';
import { CommandModule } from './command/command.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { DatasourceModule } from './datasource/datasource.module';
import { FacilityModule } from './facility/facility.module';
import { OperationMetricsModule } from './operation-metrics/operation-metrics.module';
import { MapActivationModule } from './map-activation/map-activation.module';
import { DemoSimulationModule } from './demo/demo-simulation.module';
import { MapModule } from './map/map.module';
import { TimeTemplateModule } from './time-template/time-template.module';
import { MaintenanceTaskModule } from './maintenance-task/maintenance-task.module';
import { OperationShiftModule } from './operation-shift/operation-shift.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { MediaLibraryModule } from './media-library/media-library.module';
import { VehicleDefinitionModule } from './vehicle-definition/vehicle-definition.module';
import { ScheduleAdjustModule } from './schedule-adjust/schedule-adjust.module';
import { DashboardPlaneModule } from './dashboard-plane/dashboard-plane.module';
import { DevLogModule } from './dev-log/dev-log.module';
import { SystemHealthModule } from './system-health/system-health.module';
import { DatabaseInitService } from './database/database-init.service';
import { DataAdminAudit } from './database/entities/data-admin-audit.entity';
import { DataAdminModule } from './data-admin/data-admin.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DB_HOST', '127.0.0.1'),
        port: configService.get<number>('DB_PORT', 5432),
        username: configService.get<string>('DB_USER', 'syncdrive_user'),
        password: configService.get<string>('DB_PASSWORD', 'syncdrive_password'),
        database: configService.get<string>('DB_NAME', 'syncdrive_t3'),
        entities: [
          Vehicle, OperationOrder, CommandLog, SecurityEventLog, TelemetryLog,
          OperatorActionLog, SpeedLimitConfig, JunctionInterlockLog, FieldEquipmentStatus,
          FacilitySlot, SlotStatus_, CapacityTrendDemoPoint,
          OperationRoute, OperationRouteStation, OperationRouteStationAction,
          OrderActionState, OrderEvent, TimeTemplate, MaintenanceTask, OperationShift,
          MediaLibraryItem,
          // 後勤管理層：帳號、角色、功能權限與其綁定關係
          Account, Role, Permission, RolePermission, AccountRole,
          // 後勤管理層：登入登出與權限異動稽核
          LoginLog, PermissionChangeLog,
          // 後勤管理層：系統參數與全域通知
          SystemSetting, Notification,
          // 營運核心層：全景圖台版面
          DashboardPlane,
          // 資源配置層：場域圖資版本庫與媒體排程
          MapEntity, MapVersion, MediaSchedule,
          // 圖台資料來源、載具外觀定義、模組頁面對應、班表調整簽核
          DataSource_, VehicleDefinition, ModuleDashboardPage, ScheduleAdjustRequest,
          DataAdminAudit,
          // 對外存取層：發給協力廠商、帶有效期的 API 金鑰
          PartnerApiKey,
        ],
        /**
         * 建表機制。
         *
         * <strong>這個專案目前沒有任何 migration</strong>——`synchronize` 是唯一會
         * 建立資料表的東西。所以正式環境一律關閉的規則會讓全新安裝直接掛掉：
         * 資料庫是空的、沒有人建表，服務啟動時第一支查詢就 relation does not exist，
         * 然後進入重啟迴圈（2026-08-26 在 GCP 首次部署實測）。
         *
         * 折衷做法是把它變成明確的開關：
         *
         *   DB_SYNCHRONIZE=true   依實體定義建立／調整資料表
         *   DB_SYNCHRONIZE=false  完全不動結構
         *   未設定                沿用舊行為（開發開、正式關）
         *
         * <strong>這是技術債，不是解法。</strong>synchronize 會依實體定義調整結構，
         * 欄位改名在它眼中是「刪一欄、加一欄」，升級時可能靜默刪掉資料。正解是補上
         * migration，在那之前：全新安裝開著建表，之後由部署流程決定是否關閉。
         */
        synchronize: (() => {
          const explicit = configService.get<string>('DB_SYNCHRONIZE', '').trim();
          if (explicit) return explicit.toLowerCase() === 'true';
          return configService.get<string>('NODE_ENV', 'development') !== 'production';
        })(),
        logging: configService.get<string>('DB_LOGGING', 'false') === 'true',
        retryAttempts: 15,
        retryDelay: 2000,
      }),
      inject: [ConfigService],
    }),
    MqttModule,
    RedisModule,
    EventsModule,
    OperatingDayModule,
    OrderModule,
    CommandModule,
    VehicleModule,
    DatasourceModule,
    FacilityModule,
    OperationMetricsModule,
    MapActivationModule,
    DemoSimulationModule,
    MapModule,
    TimeTemplateModule,
    MaintenanceTaskModule,
    OperationShiftModule,
    DispatchModule,
    MediaLibraryModule,
    VehicleDefinitionModule,
    ScheduleAdjustModule,
    DashboardPlaneModule,
    DevLogModule,
    PartnerAccessModule,
    SystemHealthModule,
    DataAdminModule,
  ],
  controllers: [AppController],
  providers: [AppService, DatabaseInitService],
})
export class AppModule {}
