"""Validate one already received matrix answer with PydanticAI's native-output parser.

The Node gateway owns the provider call and protected trace. This process receives
only the answer and its vacancy-derived schema through stdin and emits a safe code.
"""

from __future__ import annotations

import json
import sys
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from pydantic_ai import Agent, ModelResponse, NativeOutput, TextPart
from pydantic_ai.models.function import FunctionModel


class Criterion(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    temporaryId: str = Field(min_length=1)
    sourceRefs: list[str] = Field(min_length=1)
    sourceText: str = Field(min_length=1)
    interpretation: str = Field(min_length=1)
    category: Literal["required-experience", "desired-experience", "competency", "abc", "stop-factor", "access-to-ke", "risk", "additional"]
    required: bool
    requiredExplanation: str = Field(min_length=1)
    hardRequired: bool
    operator: Literal["ALL_OF", "ANY_OF", "AT_LEAST_N", "INFORMATIONAL"]
    atLeast: int | None = Field(ge=1)
    evaluationRule: str = Field(min_length=1)
    expectedEvidence: list[str]
    allowedStates: list[Literal["Соответствует", "Не соответствует", "Недостаточно данных"]]
    decisionEffect: Literal["stop-factor", "hard-required", "required-gap", "risk", "caveat", "informational"]
    missingDataQuestion: str
    interpretationNotes: list[str]
    children: list[Criterion]

    @field_validator("missingDataQuestion")
    @classmethod
    def nonempty_question(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("MATRIX_MISSING_QUESTION_INVALID")
        return value

class Draft(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schemaVersion: Literal["vacancy-matrix-draft/v1"]
    criteria: list[Criterion] = Field(min_length=1)


class Change(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    changeId: str = Field(min_length=1)
    sourceRefs: list[str]
    summary: str = Field(min_length=1)


class Note(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sourceRef: str = Field(min_length=1)
    note: str = Field(min_length=1)


class Critic(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    schemaVersion: Literal["vacancy-matrix-critic/v2"]
    decision: Literal["PASS", "CORRECTED"]
    changes: list[Change]
    successor: Draft
    interpretationNotes: list[Note]


def validation_code(capability: str, output: dict[str, Any], source_refs: set[str]) -> str | None:
    draft = output.get("successor") if capability == "matrix_critic" else output
    if not isinstance(draft, dict):
        return "MATRIX_CRITERIA_INVALID"
    try:
        parsed = Critic.model_validate(output).successor if capability == "matrix_critic" else Draft.model_validate(draft)
    except ValidationError as error:
        for item in error.errors():
            path = item.get("loc", ())
            if "missingDataQuestion" in path:
                return "MATRIX_MISSING_QUESTION_INVALID"
            if "sourceRefs" in path:
                return "MATRIX_SOURCE_REF_INVALID"
        return "MATRIX_CRITERIA_INVALID"
    source_points: set[tuple[str, str]] = set()
    def inspect(nodes: list[Criterion], top_level: bool) -> str | None:
        for criterion in nodes:
            for ref in criterion.sourceRefs:
                if ref not in source_refs:
                    return "MATRIX_SOURCE_REF_INVALID"
                if top_level:
                    point = (ref, criterion.sourceText.strip())
                    if point in source_points:
                        return "MATRIX_OVER_SPLIT"
                    source_points.add(point)
            child_code = inspect(criterion.children, False)
            if child_code:
                return child_code
        return None
    return inspect(parsed.criteria, True)


def parse_with_pydantic_ai(payload: dict[str, Any]) -> str | None:
    capability = payload.get("capability")
    schema = payload.get("schema")
    output = payload.get("output")
    source_refs = payload.get("sourceRefs")
    if capability not in ("matrix_compiler", "matrix_critic") or not isinstance(schema, dict) \
            or not isinstance(output, dict) or not isinstance(source_refs, list) \
            or not source_refs or not all(isinstance(ref, str) for ref in source_refs):
        return "MATRIX_PYDANTIC_INPUT_INVALID"
    try:
        schema_refs = schema["$defs"]["criterion"]["properties"]["sourceRefs"]["items"]["enum"]
    except (KeyError, TypeError):
        return "MATRIX_PYDANTIC_INPUT_INVALID"
    if not isinstance(schema_refs, list) or set(schema_refs) != set(source_refs):
        return "MATRIX_PYDANTIC_INPUT_INVALID"

    answer_text = json.dumps(output, ensure_ascii=False, separators=(",", ":"))

    async def cached_response(_messages: Any, _info: Any) -> ModelResponse:
        return ModelResponse(parts=[TextPart(answer_text)])

    output_type = Critic if capability == "matrix_critic" else Draft
    agent = Agent(FunctionModel(cached_response), output_type=NativeOutput(output_type), retries=0)
    try:
        agent.run_sync("Validate the received structured answer")
    except Exception:
        return validation_code(capability, output, set(source_refs)) or "MATRIX_PYDANTIC_PARSE_FAILED"
    return validation_code(capability, output, set(source_refs))


def main() -> None:
    try:
        payload = json.load(sys.stdin)
        code = parse_with_pydantic_ai(payload)
    except Exception:
        code = "MATRIX_PYDANTIC_RUNTIME_FAILED"
    json.dump({"ok": code is None, **({} if code is None else {"code": code})}, sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
