import postgres, { type Sql } from "postgres";

export interface PostgresOptions {
  url: string;
  max?: number;
  idleTimeoutSeconds?: number;
  connectTimeoutSeconds?: number;
}

// postgres-js uses `{}` to mean "no custom PostgreSQL codecs" in its public Sql generic.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type PostgresClient = Sql<{}>;

export function createPostgresClient(options: PostgresOptions): PostgresClient {
  return postgres(options.url, {
    max: options.max ?? 10,
    idle_timeout: options.idleTimeoutSeconds ?? 20,
    connect_timeout: options.connectTimeoutSeconds ?? 10,
    max_lifetime: 60 * 30,
    prepare: true,
    onnotice: () => undefined,
  });
}

export async function withTransaction<T>(client: PostgresClient, operation: (transaction: PostgresClient) => Promise<T>): Promise<T> {
  return client.begin(async (transaction) => operation(transaction as unknown as PostgresClient)) as Promise<T>;
}

export async function probePostgres(client: PostgresClient): Promise<{ backend: "postgresql"; serverMajor: number }> {
  const [row] = await client<{ version: number }[]>`SELECT current_setting('server_version_num')::integer AS version`;
  const serverMajor = Math.floor(row.version / 10000);
  if (serverMajor < 16) throw new Error("POSTGRESQL_16_REQUIRED");
  return { backend: "postgresql", serverMajor };
}
