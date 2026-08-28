ALTER TABLE vacancy_matrix_compilations
  ADD COLUMN workflow_identity text NOT NULL DEFAULT 'matrix-v2';
--> statement-breakpoint
ALTER TABLE vacancy_matrix_compilations
  DROP CONSTRAINT vacancy_matrix_compilations_pkey;
--> statement-breakpoint
ALTER TABLE vacancy_matrix_compilations
  ADD CONSTRAINT vacancy_matrix_compilations_pkey PRIMARY KEY (profile_version, workflow_identity);
--> statement-breakpoint

ALTER TABLE vacancy_matrices
  ADD COLUMN workflow_identity text NOT NULL DEFAULT 'matrix-v2';
--> statement-breakpoint
ALTER TABLE vacancy_matrices
  DROP CONSTRAINT vacancy_matrices_profile_version_key;
--> statement-breakpoint
ALTER TABLE vacancy_matrices
  ADD CONSTRAINT vacancy_matrices_profile_workflow_key UNIQUE (profile_version, workflow_identity);
--> statement-breakpoint
CREATE INDEX vacancy_matrices_profile_workflow_idx
  ON vacancy_matrices(profile_version, workflow_identity);
