import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('account_sessions')
@Index('IDX_ACCOUNT_SESSION_TOKEN', ['tokenHash'], { unique: true })
@Index('IDX_ACCOUNT_SESSION_ACCOUNT', ['accountId'])
export class AccountSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'account_id', type: 'uuid' })
  accountId: string;

  @Column({ name: 'token_hash', length: 64 })
  tokenHash: string;

  @Column({ name: 'csrf_hash', length: 64 })
  csrfHash: string;

  @Column({ name: 'source_ip', type: 'varchar', nullable: true })
  sourceIp: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent: string | null;

  @Column({ name: 'expires_at', type: 'bigint', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  expiresAt: number;

  @Column({ name: 'created_at', type: 'bigint', default: () => 'EXTRACT(EPOCH FROM NOW()) * 1000', transformer: { to: (v: number) => v, from: (v: string) => Number(v) } })
  createdAt: number;
}
