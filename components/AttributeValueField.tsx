import { attributeValueError } from "@/lib/itemFields";

export { attributeValueError };
import type { Attribute, DataType } from "@/lib/types";

export function attributeLabel(name: string, unit: string | null): string {
  return unit ? `${name} (${unit})` : name;
}

export function valuesMatch(dataType: DataType, left: string, right: string): boolean {
  if (dataType === "text") return left.trim().toLowerCase() === right.trim().toLowerCase();
  if (left.trim() === "" || right.trim() === "") return false;
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && a === b;
}

export function canonicalValue(attribute: Attribute, value: string): string {
  if (!attribute.uses_list) return value;
  const match = attribute.allowedValues.find((option) =>
    valuesMatch(attribute.data_type, option, value),
  );
  return match ?? value;
}

type AttributeValueFieldProps = {
  attribute: Attribute;
  value: string;
  onChange: (value: string) => void;
};

export function AttributeValueField({ attribute, value, onChange }: AttributeValueFieldProps) {
  const listId = `attribute-values-${attribute.id}`;
  const trimmed = value.trim();
  const isNew =
    attribute.uses_list &&
    trimmed !== "" &&
    !attribute.allowedValues.some((option) => valuesMatch(attribute.data_type, option, trimmed));

  return (
    <label>
      {attributeLabel(attribute.name, attribute.unit)}
      <input
        list={attribute.uses_list && attribute.allowedValues.length > 0 ? listId : undefined}
        className={attribute.data_type === "text" ? undefined : "num"}
        value={value}
        autoComplete="off"
        inputMode={
          attribute.data_type === "decimal"
            ? "decimal"
            : attribute.data_type === "integer"
              ? "numeric"
              : undefined
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {attribute.uses_list && attribute.allowedValues.length > 0 ? (
        <datalist id={listId}>
          {attribute.allowedValues.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
      ) : null}
      {isNew ? (
        <span className="hint">New value. It is added to the list when you save.</span>
      ) : null}
    </label>
  );
}
