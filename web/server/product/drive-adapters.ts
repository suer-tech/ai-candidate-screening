import { googleDriveOAuthRuntime } from "../google-drive-oauth/runtime-binding.ts";
import { PostgresCandidateArtifactStore } from "../candidate-pipeline/artifact-store.ts";
import { serverContainer } from "../configuration/container.ts";
import { PostgresBlobStore } from "../storage/blob-store.ts";
import type { ResultArtifactGateway, VacancyFolderGateway } from "./application.ts";

export class DriveVacancyFolderGateway implements VacancyFolderGateway {
  async ensureVacancyFolder(input: { operationId: string; vacancyId: string; title: string }) {
    const oauth = await googleDriveOAuthRuntime();
    const drive = await oauth.drive();
    const connection = await oauth.repository.getConnection();
    if (!connection || connection.state !== "CONNECTED") throw new Error("GOOGLE_DRIVE_REAUTH_REQUIRED");
    const folder = await drive.ensureFolder({
      name: input.title,
      parentFolderId: connection.rootFolderId,
      operationIdentity: `vacancy:${input.vacancyId}:${input.operationId}`,
    });
    return folder.id;
  }
}

export class DriveResultArtifactGateway implements ResultArtifactGateway {
  async readPdf(storageId: string) {
    return (await (await googleDriveOAuthRuntime()).drive()).downloadFile(storageId);
  }
  async readImmutablePdf(artifactRef: string) {
    const container = await serverContainer();
    return new PostgresCandidateArtifactStore(new PostgresBlobStore(container.sql)).getBytes(artifactRef);
  }
}
