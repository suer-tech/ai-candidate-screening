import { GoogleDriveOAuthError } from "./types.ts";

export type ScopedDriveOperation = "list" | "download" | "ensure-folder" | "publish" | "cleanup";

export type DriveResourceAuthorization = {
  allowed: boolean;
  code?: string;
  grantId?: string;
  connectionId?: string;
  rootFolderId?: string;
  candidateId?: number | string;
  inputVersion?: string;
  secretResolved?: boolean;
};

export class ScopedGoogleDriveExecutor {
  private readonly boundary: {
    authorize(input: { taskId: string; grantId: string; operation: string; fileId: string; now: number }): Promise<DriveResourceAuthorization>;
    prepare(input: { taskId: string; grantId: string; operation: string; operationIdentity: string; now: number }): Promise<void>;
  };

  constructor(boundary: ScopedGoogleDriveExecutor["boundary"]) { this.boundary = boundary; }

  async execute<T>(input: {
    taskId: string;
    grantId: string;
    operation: ScopedDriveOperation;
    fileId: string;
    operationIdentity: string;
    expected: { connectionId: string; rootFolderId: string; candidateId: number | string; inputVersion: string };
    effect(): Promise<T>;
    now?: number;
  }) {
    const now = input.now ?? Date.now();
    const authorization = await this.boundary.authorize({ taskId: input.taskId, grantId: input.grantId, operation: input.operation, fileId: input.fileId, now });
    if (!authorization.allowed) throw new GoogleDriveOAuthError(authorization.code ?? "GOOGLE_DRIVE_ROOT_OR_GRANT_DENIED");
    if (authorization.connectionId !== input.expected.connectionId || authorization.rootFolderId !== input.expected.rootFolderId
      || String(authorization.candidateId) !== String(input.expected.candidateId) || authorization.inputVersion !== input.expected.inputVersion) {
      throw new GoogleDriveOAuthError("GOOGLE_DRIVE_RUNTIME_SCOPE_MISMATCH");
    }
    await this.boundary.prepare({ taskId: input.taskId, grantId: input.grantId, operation: input.operation, operationIdentity: input.operationIdentity, now });
    return input.effect();
  }
}
