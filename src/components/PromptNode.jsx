import { Handle, Position } from "@xyflow/react";

const roleStyles = {
  system: "node-system",
  user: "node-user",
  assistant: "node-assistant",
  condition: "node-condition"
};

const makeItemId = () => `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function normalizeListItems(items, fallbackContent = "") {
  if (Array.isArray(items) && items.length) {
    return items.map((item) => {
      if (typeof item === "string") {
        return { id: makeItemId(), text: item, level: 1 };
      }
      return {
        id: item?.id || makeItemId(),
        text: item?.text ?? "",
        level: Math.max(1, Math.min(3, Number(item?.level) || 1))
      };
    });
  }

  if (fallbackContent) {
    const lines = fallbackContent
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length) {
      return lines.map((line) => {
        const match = line.match(/^(\d+(?:\.\d+)*)(?:\.)?\s+(.+)$/);
        if (match) {
          return {
            id: makeItemId(),
            text: match[2],
            level: Math.max(1, Math.min(3, match[1].split(".").length))
          };
        }
        return { id: makeItemId(), text: line, level: 1 };
      });
    }
  }

  return [{ id: makeItemId(), text: "", level: 1 }];
}

function buildDisplayTokens(items) {
  const counters = [0, 0, 0];
  return items.map((item) => {
    const level = Math.max(1, Math.min(3, Number(item.level) || 1));
    counters[level - 1] += 1;
    for (let index = level; index < counters.length; index += 1) {
      counters[index] = 0;
    }
    return counters.slice(0, level).join(".");
  });
}

export default function PromptNode({ data, isSelected, onSelect, onListChange }) {
  const roleClass = roleStyles[data.role] ?? "node-user";
  const listItems = normalizeListItems(data.listItems, data.content);
  const displayTokens = buildDisplayTokens(listItems);

  return (
    <div className={`prompt-node ${roleClass} ${isSelected ? "selected" : ""}`} onClick={onSelect}>
      <Handle type="target" position={Position.Top} />
      <div className="node-header">
        <span>{data.label || "Untitled"}</span>
        <small>{data.role}</small>
      </div>
      <div className="node-list-editor">
        {listItems.map((item, index) => (
          <div key={item.id} className="node-list-row">
            <span className="node-list-index">{displayTokens[index]}.</span>
            <input
              className="nodrag nopan"
              value={item.text}
              placeholder={`Item ${index + 1}`}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => {
                const next = [...listItems];
                next[index] = { ...next[index], text: event.target.value };
                onListChange(next);
              }}
            />
            <button
              type="button"
              className="node-list-level nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                const next = [...listItems];
                next[index] = { ...next[index], level: Math.max(1, next[index].level - 1) };
                onListChange(next);
              }}
              aria-label={`Outdent item ${index + 1}`}
              title="Outdent"
            >
              {"<"}
            </button>
            <button
              type="button"
              className="node-list-level nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                const next = [...listItems];
                next[index] = { ...next[index], level: Math.min(3, next[index].level + 1) };
                onListChange(next);
              }}
              aria-label={`Indent item ${index + 1}`}
              title="Indent"
            >
              {">"}
            </button>
            <button
              type="button"
              className="node-list-delete nodrag nopan"
              onClick={(event) => {
                event.stopPropagation();
                const next = listItems.filter((_, i) => i !== index);
                onListChange(next.length ? next : [{ id: makeItemId(), text: "", level: 1 }]);
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
            onListChange([...listItems, { id: makeItemId(), text: "", level: 1 }]);
          }}
        >
          + item
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
