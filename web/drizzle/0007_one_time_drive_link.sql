DROP TRIGGER IF EXISTS candidate_report_documents_immutable;
--> statement-breakpoint
CREATE TRIGGER candidate_report_documents_immutable
BEFORE UPDATE ON candidate_report_documents
WHEN NOT (
  OLD.id = NEW.id
  AND OLD.report_version_id = NEW.report_version_id
  AND OLD.type = NEW.type
  AND OLD.file_name = NEW.file_name
  AND OLD.checksum = NEW.checksum
  AND OLD.byte_size = NEW.byte_size
  AND OLD.validation_json = NEW.validation_json
  AND OLD.drive_file_id IS NULL
  AND NEW.drive_file_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_REPORT_DOCUMENT');
END;
