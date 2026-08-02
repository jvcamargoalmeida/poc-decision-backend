import oracledb from 'oracledb';
import { logger } from '../../logger/winston.logger';

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

let pool: oracledb.Pool | undefined;

export async function initOraclePool(): Promise<oracledb.Pool> {
  if (pool) {
    return pool;
  }

  pool = await oracledb.createPool({
    user: process.env.ORACLE_USER,
    password: process.env.ORACLE_PASSWORD,
    connectString: process.env.ORACLE_CONNECT_STRING,
    poolMin: Number(process.env.ORACLE_POOL_MIN) || 2,
    poolMax: Number(process.env.ORACLE_POOL_MAX) || 10,
    poolIncrement: Number(process.env.ORACLE_POOL_INCREMENT) || 1,
  });

  logger.info('Oracle connection pool initialized');

  return pool;
}

export function getOraclePool(): oracledb.Pool {
  if (!pool) {
    throw new Error('Oracle pool not initialized. Call initOraclePool() first.');
  }

  return pool;
}

export async function closeOraclePool(): Promise<void> {
  if (pool) {
    await pool.close(10);
    pool = undefined;
    logger.info('Oracle connection pool closed');
  }
}
