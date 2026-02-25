import { Handle, Position } from "@xyflow/react";

const roleStyles = {
  system: "node-system",
  user: "node-user",
  assistant: "node-assistant",
  condition: "node-condition"
};

export default function PromptNode({ data, isSelected, onSelect, onListChange }) {
  const roleClass = roleStyles[data.role] ?? "node-user";
  const listItems =
    data.listItems && data.listItems.length
      ? data.listItems
      : data.content
        ? data.content.split("\n").map((line) => line.replace(/^\d+\.\s*/, ""))
        : [""];

  return (
    <div className={`prompt-node ${roleClass} ${isSelected ? "selected" : ""}`} onClick={onSelect}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span>{data.label || "Untitled"}</span>
        <small>{data.role}</small>
      </div>
      <div className="node-list-editor">
        {listItems.map((item, index) => (
          <div key={`${index}-${data.id ?? data.label}`} className="node-list-row">
            <span className="node-list-index">{index + 1}.</span>
            <input
              className="nodrag nopan"
              value={item}
              placeholder={`Item ${index + 1}`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const next = [...listItems];
                next[index] = event.target.value;
                onListChange(next);
              }}
            />
            <button
              type="button"
              className="node-list-delete nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                const next = listItems.filter((_, i) => i !== index);
                onListChange(next.length ? next : [""]);
              }}
              aria-label={`Remove item ${index + 1}`}
            >
              x
            </button>
          </div>
        ))}
        <button
          type="button"
          className="node-list-add nodrag nopan"
          onClick={(event) => {
            event.stopPropagation();
            onListChange([...listItems, ""]);
          }}
        >
          + item
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
