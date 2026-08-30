import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PartnerApiKey } from '../database/entities/partner-api-key.entity';
import { PartnerAccessController } from './partner-access.controller';
import { PartnerAccessService } from './partner-access.service';
import { VehicleCertificateIssuer } from './vehicle-certificate.issuer';

/**
 * 對外存取憑據。
 *
 * 標成 <code>@Global</code> 是因為 {@link ApiKeyGuard} 掛在各個對外端點上，
 * 而那些端點分散在不同模組裡。守衛要能查驗發出去的金鑰就得拿得到這個服務——
 * 逐一在每個模組 import 一次，只要有人新增對外端點時忘了加，那支端點就會
 * 退回「只認固定金鑰」，而且不會有任何錯誤。
 */
@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([PartnerApiKey])],
  controllers: [PartnerAccessController],
  providers: [PartnerAccessService, VehicleCertificateIssuer],
  exports: [PartnerAccessService, VehicleCertificateIssuer],
})
export class PartnerAccessModule {}
