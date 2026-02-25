import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import PromptNode from "./components/PromptNode";

const TEMPLATE_NODES = [
  { role: "system", label: "System", hint: "Global rules and behavior" },
  { role: "user", label: "User", hint: "User intent or inputs" },
  { role: "assistant", label: "Assistant", hint: "Assistant response template" },
  { role: "condition", label: "Condition", hint: "Branching rule for next step" }
];

const createListItem = (text = "", level = 1) => ({
  id: `li-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  text,
  level: Math.max(1, Math.min(3, Number(level) || 1))
});

const normalizeListItems = (items = [], fallbackContent = "") => {
  if (Array.isArray(items) && items.length) {
    return items.map((item) => {
      if (typeof item === "string") {
        return createListItem(item, 1);
      }
      return {
        id: item?.id || createListItem().id,
        text: item?.text ?? "",
        level: Math.max(1, Math.min(3, Number(item?.level) || 1))
      };
    });
  }

  const lines = (fallbackContent || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length) {
    return lines.map((line) => {
      const match = line.match(/^(\d+(?:\.\d+)*)(?:\.)?\s+(.+)$/);
      if (match) {
        return createListItem(match[2], match[1].split(".").length);
      }
      return createListItem(line, 1);
    });
  }

  return [createListItem("", 1)];
};

const formatNumberedList = (items = []) => {
  const normalized = normalizeListItems(items);
  const counters = [0, 0, 0];

  return normalized
    .map((item) => {
      const level = Math.max(1, Math.min(3, item.level));
      counters[level - 1] += 1;
      for (let index = level; index < counters.length; index += 1) {
        counters[index] = 0;
      }
      const token = counters.slice(0, level).join(".");
      const text = (item.text ?? "").trim();
      if (!text) {
        return "";
      }
      return `${token} ${text}`;
    })
    .filter(Boolean)
    .join("\n");
};

const initialNodes = [
  {
    id: "n1",
    type: "promptNode",
    position: { x: 120, y: 120 },
    data: {
      role: "system",
      label: "System",
      listItems: [
        createListItem("You are a careful assistant.", 1),
        createListItem("Always provide structured output.", 1)
      ],
      content: "1 You are a careful assistant.\n2 Always provide structured output."
    }
  },
  {
    id: "n2",
    type: "promptNode",
    position: { x: 420, y: 300 },
    data: {
      role: "user",
      label: "User",
      listItems: [
        createListItem("Summarize the latest ticket updates.", 1),
        createListItem("Suggest next actions.", 1)
      ],
      content: "1 Summarize the latest ticket updates.\n2 Suggest next actions."
    }
  }
];

const initialEdges = [
  {
    id: "e-n1-n2",
    source: "n1",
    target: "n2",
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed }
  }
];

const nodeTypes = { promptNode: PromptNode };
const FLOW_STORAGE_KEY = "prompt-flow-designer.v1";

function getInitialFlowState() {
  const fallback = {
    nodes: initialNodes,
    edges: initialEdges,
    selectedNodeId: initialNodes[0]?.id ?? null
  };

  if (typeof window === "undefined") {
    return fallback;
  }

  try {
    const raw = window.localStorage.getItem(FLOW_STORAGE_KEY);
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.nodes) || !Array.isArray(parsed?.edges)) {
      return fallback;
    }

    const selectedNodeId =
      typeof parsed.selectedNodeId === "string" &&
      parsed.nodes.some((node) => node?.id === parsed.selectedNodeId)
        ? parsed.selectedNodeId
        : parsed.nodes[0]?.id ?? null;

    return {
      nodes: parsed.nodes,
      edges: parsed.edges,
      selectedNodeId
    };
  } catch {
    return fallback;
  }
}

const FLOW_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    nodes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          role: { type: "string", enum: ["system", "user", "assistant"] },
          label: { type: "string" },
          content: { type: "string" }
        },
        required: ["id", "role", "label", "content"]
      }
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          from: { type: "string" },
          to: { type: "string" }
        },
        required: ["from", "to"]
      }
    }
  },
  required: ["nodes", "edges"]
};

const AI_RULES = [
  "Each node must have a unique id.",
  "Edges must reference valid node ids.",
  "The flow must be sequential unless branching is explicitly requested.",
  "Do not create empty content nodes unless explicitly required.",
  "Preserve logical order of conversation.",
  "Ensure the graph is a valid directed flow (no orphan nodes)."
];

function parsePromptTextToGraph(text) {
  const raw = text.trim();
  if (!raw) {
    return { error: "Prompt text is empty." };
  }

  const directJson = extractJsonObject(raw);
  if (directJson && Array.isArray(directJson.nodes) && Array.isArray(directJson.edges)) {
    return { graph: directJson };
  }

  const rawLines = raw.split("\n");
  const parentChildNodes = [];
  let currentParent = null;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const parentMatch = trimmed.match(/^\[(\d+)\]\s*(SYSTEM|USER|ASSISTANT)\s*$/i);
    if (parentMatch) {
      if (currentParent) {
        parentChildNodes.push(currentParent);
      }
      currentParent = {
        parentNo: parentMatch[1],
        role: parentMatch[2].toLowerCase(),
        children: []
      };
      continue;
    }

    if (!currentParent) {
      continue;
    }

    const childRegex = new RegExp(`^${currentParent.parentNo}\\.\\d+\\s+(.+)$`);
    const childMatch = trimmed.match(childRegex);
    if (childMatch) {
      currentParent.children.push(childMatch[1].trim());
    } else if (currentParent.children.length) {
      const lastIndex = currentParent.children.length - 1;
      currentParent.children[lastIndex] = `${currentParent.children[lastIndex]} ${trimmed}`.trim();
    }
  }

  if (currentParent) {
    parentChildNodes.push(currentParent);
  }

  if (parentChildNodes.length) {
    const nodes = parentChildNodes.map((item, index) => {
      const content = item.children.length
        ? item.children.map((child, childIndex) => `${childIndex + 1}. ${child}`).join("\n")
        : "No content";
      return {
        id: `import-${index + 1}`,
        role: item.role,
        label: item.role[0].toUpperCase() + item.role.slice(1),
        content
      };
    });

    const edges = nodes.slice(0, -1).map((node, index) => ({
      from: node.id,
      to: nodes[index + 1].id
    }));

    return { graph: { nodes, edges } };
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const outlineNodes = [];
  let currentSection = "";
  for (const line of lines) {
    const numberedMatch = line.match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/);
    if (numberedMatch) {
      const stepNo = numberedMatch[1];
      const stepText = numberedMatch[2].trim();
      if (!stepText) {
        continue;
      }
      outlineNodes.push({
        role: "user",
        label: currentSection ? `${currentSection} (${stepNo})` : `Step ${stepNo}`,
        content: currentSection ? `${currentSection}: ${stepText}` : stepText
      });
      continue;
    }
    currentSection = line;
  }

  if (outlineNodes.length) {
    const nodes = outlineNodes.map((item, index) => ({
      id: `import-${index + 1}`,
      role: item.role,
      label: item.label,
      content: item.content
    }));
    const edges = nodes.slice(0, -1).map((node, index) => ({
      from: node.id,
      to: nodes[index + 1].id
    }));
    return { graph: { nodes, edges } };
  }

  const blockRegex = /\[\d+\]\s*(SYSTEM|USER|ASSISTANT|CONDITION)\s*\n([\s\S]*?)(?=\n\[\d+\]\s*(?:SYSTEM|USER|ASSISTANT|CONDITION)\s*\n|$)/gi;
  const blocks = [];
  let match = blockRegex.exec(raw);
  while (match) {
    blocks.push({
      role: match[1].toLowerCase(),
      content: match[2].trim()
    });
    match = blockRegex.exec(raw);
  }

  let parsedNodes = blocks.filter((b) => b.content);

  if (!parsedNodes.length) {
    const linePattern = raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(system|user|assistant|condition)\s*:\s*(.+)$/i);
        if (!m) {
          return null;
        }
        return { role: m[1].toLowerCase(), content: m[2].trim() };
      })
      .filter(Boolean);
    parsedNodes = linePattern;
  }

  if (!parsedNodes.length) {
    parsedNodes = [{ role: "user", content: raw }];
  }

  const nodes = parsedNodes.map((item, index) => ({
    id: `import-${index + 1}`,
    role: item.role,
    label: item.role[0].toUpperCase() + item.role.slice(1),
    content: item.content
  }));

  const edges = nodes.slice(0, -1).map((node, index) => ({
    from: node.id,
    to: nodes[index + 1].id
  }));

  return { graph: { nodes, edges } };
}

function extractJsonObject(text) {
  if (!text) {
    return null;
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/```json\s*([\s\S]*?)\s*```/i) || trimmed.match(/({[\s\S]*})/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  }
}

function validateGeneratedGraph(graph) {
  if (!graph || typeof graph !== "object") {
    return "Invalid JSON: root must be an object.";
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    return "Invalid JSON: `nodes` and `edges` must be arrays.";
  }
  if (!graph.nodes.length) {
    return "Invalid flow: at least one node is required.";
  }

  const validRoles = new Set(["system", "user", "assistant"]);
  const nodeIds = new Set();
  const degree = new Map();
  const indegree = new Map();
  const outgoing = new Map();

  for (const node of graph.nodes) {
    if (!node?.id || typeof node.id !== "string") {
      return "Invalid node: every node must have a string `id`.";
    }
    if (nodeIds.has(node.id)) {
      return `Invalid flow: duplicate node id '${node.id}'.`;
    }
    if (!validRoles.has(node.role)) {
      return `Invalid node '${node.id}': role must be system, user, or assistant.`;
    }
    if (typeof node.label !== "string") {
      return `Invalid node '${node.id}': label must be a string.`;
    }
    if (typeof node.content !== "string" || !node.content.trim()) {
      return `Invalid node '${node.id}': content cannot be empty.`;
    }
    nodeIds.add(node.id);
    degree.set(node.id, 0);
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    if (!edge?.from || !edge?.to || typeof edge.from !== "string" || typeof edge.to !== "string") {
      return "Invalid edge: each edge must include string `from` and `to`.";
    }
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return `Invalid edge: '${edge.from}' -> '${edge.to}' references missing node ids.`;
    }
    if (edge.from === edge.to) {
      return `Invalid edge: self-loop found on '${edge.from}'.`;
    }
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from).push(edge.to);
  }

  if (graph.nodes.length > 1) {
    const orphan = graph.nodes.find((n) => (degree.get(n.id) ?? 0) === 0);
    if (orphan) {
      return `Invalid flow: orphan node '${orphan.id}' has no edges.`;
    }
  }

  const queue = [];
  const indegreeCopy = new Map(indegree);
  for (const node of graph.nodes) {
    if ((indegreeCopy.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
    }
  }
  let visited = 0;
  while (queue.length) {
    const id = queue.shift();
    visited += 1;
    for (const target of outgoing.get(id) ?? []) {
      indegreeCopy.set(target, (indegreeCopy.get(target) ?? 0) - 1);
      if ((indegreeCopy.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }
  if (visited !== graph.nodes.length) {
    return "Invalid flow: graph must be directed and acyclic.";
  }

  return null;
}

function layoutGraph(graph) {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const indegree = new Map(graph.nodes.map((n) => [n.id, 0]));
  const outgoing = new Map(graph.nodes.map((n) => [n.id, []]));

  graph.edges.forEach((edge) => {
    indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    outgoing.get(edge.from).push(edge.to);
  });

  const level = new Map();
  const queue = [];
  graph.nodes.forEach((node) => {
    if ((indegree.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
      level.set(node.id, 0);
    }
  });

  while (queue.length) {
    const current = queue.shift();
    for (const target of outgoing.get(current) ?? []) {
      const nextLevel = (level.get(current) ?? 0) + 1;
      if (!level.has(target) || nextLevel > level.get(target)) {
        level.set(target, nextLevel);
      }
      indegree.set(target, (indegree.get(target) ?? 0) - 1);
      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  const grouped = new Map();
  graph.nodes.forEach((node) => {
    const l = level.get(node.id) ?? 0;
    if (!grouped.has(l)) {
      grouped.set(l, []);
    }
    grouped.get(l).push(node.id);
  });

  const rfNodes = [];
  [...grouped.keys()].sort((a, b) => a - b).forEach((l) => {
    const ids = grouped.get(l);
    ids.forEach((id, lane) => {
      const node = nodesById.get(id);
      const listItems = normalizeListItems([], node.content);
      rfNodes.push({
        id: node.id,
        type: "promptNode",
        position: { x: 120 + lane * 320, y: 100 + l * 220 },
        data: {
          role: node.role,
          label: node.label,
          content: node.content,
          listItems
        }
      });
    });
  });

  const rfEdges = graph.edges.map((edge, index) => ({
    id: `e-${edge.from}-${edge.to}-${index}`,
    source: edge.from,
    target: edge.to,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed }
  }));

  return { rfNodes, rfEdges };
}

function autoLayoutNodes(currentNodes, currentEdges, mode) {
  if (!currentNodes.length) {
    return currentNodes;
  }

  const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
  const outgoing = new Map(currentNodes.map((node) => [node.id, []]));
  const indegree = new Map(currentNodes.map((node) => [node.id, 0]));

  currentEdges.forEach((edge) => {
    if (!nodesById.has(edge.source) || !nodesById.has(edge.target)) {
      return;
    }
    outgoing.get(edge.source).push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  });

  const sortByCanvas = (a, b) => {
    const nodeA = nodesById.get(a);
    const nodeB = nodesById.get(b);
    if (!nodeA || !nodeB) {
      return 0;
    }
    return nodeA.position.y - nodeB.position.y || nodeA.position.x - nodeB.position.x;
  };

  const indegreeCopy = new Map(indegree);
  const queue = currentNodes
    .map((node) => node.id)
    .filter((id) => (indegreeCopy.get(id) ?? 0) === 0)
    .sort(sortByCanvas);

  const level = new Map();
  queue.forEach((id) => level.set(id, 0));
  let maxLevel = 0;

  while (queue.length) {
    const current = queue.shift();
    const currentLevel = level.get(current) ?? 0;
    maxLevel = Math.max(maxLevel, currentLevel);
    for (const target of outgoing.get(current) ?? []) {
      const nextLevel = currentLevel + 1;
      if (!level.has(target) || nextLevel > (level.get(target) ?? 0)) {
        level.set(target, nextLevel);
      }
      indegreeCopy.set(target, (indegreeCopy.get(target) ?? 0) - 1);
      if ((indegreeCopy.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  const unresolved = currentNodes
    .map((node) => node.id)
    .filter((id) => !level.has(id))
    .sort(sortByCanvas);
  unresolved.forEach((id, index) => {
    level.set(id, maxLevel + 1 + index);
  });

  if (mode === "grid") {
    const sorted = [...currentNodes].sort(
      (a, b) =>
        (level.get(a.id) ?? 0) - (level.get(b.id) ?? 0) ||
        a.position.y - b.position.y ||
        a.position.x - b.position.x
    );
    const columns = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
    const startX = 100;
    const startY = 100;
    const gapX = 320;
    const gapY = 220;
    const positionById = new Map(
      sorted.map((node, index) => [
        node.id,
        {
          x: startX + (index % columns) * gapX,
          y: startY + Math.floor(index / columns) * gapY
        }
      ])
    );
    return currentNodes.map((node) => ({
      ...node,
      position: positionById.get(node.id) ?? node.position
    }));
  }

  const grouped = new Map();
  currentNodes.forEach((node) => {
    const l = level.get(node.id) ?? 0;
    if (!grouped.has(l)) {
      grouped.set(l, []);
    }
    grouped.get(l).push(node.id);
  });

  [...grouped.keys()].forEach((l) => grouped.get(l).sort(sortByCanvas));

  const startX = 100;
  const startY = 100;
  const gapX = 320;
  const gapY = 220;
  const positionById = new Map();

  [...grouped.keys()].sort((a, b) => a - b).forEach((l) => {
    grouped.get(l).forEach((id, lane) => {
      const position =
        mode === "horizontal"
          ? { x: startX + l * gapX, y: startY + lane * gapY }
          : { x: startX + lane * gapX, y: startY + l * gapY };
      positionById.set(id, position);
    });
  });

  return currentNodes.map((node) => ({
    ...node,
    position: positionById.get(node.id) ?? node.position
  }));
}

function buildPromptOutput(nodes, edges) {
  if (!nodes.length) {
    return {
      sequence: [],
      structuredPrompt: "",
      graph: { nodes: [], edges: [] }
    };
  }

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map();
  const indegree = new Map(nodes.map((n) => [n.id, 0]));

  edges.forEach((e) => {
    if (!outgoing.has(e.source)) {
      outgoing.set(e.source, []);
    }
    outgoing.get(e.source).push(e.target);
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1);
  });

  const starts = nodes
    .filter((n) => (indegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);

  const visited = new Set();
  const ordered = [];

  const walk = (id) => {
    if (visited.has(id)) {
      return;
    }
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) {
      return;
    }
    ordered.push(node);
    const targets = [...(outgoing.get(id) ?? [])].sort((a, b) => {
      const nodeA = nodeMap.get(a);
      const nodeB = nodeMap.get(b);
      if (!nodeA || !nodeB) {
        return 0;
      }
      return nodeA.position.y - nodeB.position.y || nodeA.position.x - nodeB.position.x;
    });
    targets.forEach(walk);
  };

  starts.forEach((start) => walk(start.id));
  nodes.forEach((n) => walk(n.id));

  const sequence = ordered.map((node, index) => ({
    step: index + 1,
    id: node.id,
    role: node.data.role,
    label: node.data.label,
    content: node.data.content
  }));

  const structuredPrompt = sequence
    .map((item) => `[${item.step}] ${item.role.toUpperCase()}\n${item.content || "(empty)"}`)
    .join("\n\n");

  const graph = {
    nodes: nodes.map((node) => ({
      id: node.id,
      role: node.data.role,
      label: node.data.label,
      content: node.data.content
    })),
    edges: edges.map((edge) => ({
      from: edge.source,
      to: edge.target
    }))
  };

  return { sequence, structuredPrompt, graph };
}

function FlowDesigner() {
  const initialFlowState = useMemo(() => getInitialFlowState(), []);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialFlowState.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialFlowState.edges);
  const [selectedNodeId, setSelectedNodeId] = useState(initialFlowState.selectedNodeId);
  const [instance, setInstance] = useState(null);
  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [generatorPrompt, setGeneratorPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generatedGraph, setGeneratedGraph] = useState(null);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importPromptText, setImportPromptText] = useState("");
  const [importError, setImportError] = useState("");
  const [layoutMode, setLayoutMode] = useState("vertical");
  const [leftPanelCollapsed, setLeftPanelCollapsed] = useState(false);
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState(false);

  const updateNodeData = useCallback((nodeId, patch) => {
    setNodes((current) =>
      current.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...patch } } : node
      )
    );
  }, [setNodes]);

  const updateNodeList = useCallback(
    (nodeId, listItems) => {
      const safeItems = normalizeListItems(listItems);
      updateNodeData(nodeId, {
        listItems: safeItems,
        content: formatNumberedList(safeItems)
      });
    },
    [updateNodeData]
  );

  const onConnect = useCallback(
    (params) =>
      setEdges((current) =>
        addEdge(
          {
            ...params,
            type: "smoothstep",
            markerEnd: { type: MarkerType.ArrowClosed }
          },
          current
        )
      ),
    [setEdges]
  );

  const onDragStart = (event, template) => {
    event.dataTransfer.setData("application/prompt-node", JSON.stringify(template));
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event) => {
      event.preventDefault();
      if (!instance) {
        return;
      }
      const raw = event.dataTransfer.getData("application/prompt-node");
      if (!raw) {
        return;
      }
      const template = JSON.parse(raw);
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY
      });
      const id = `n-${Date.now()}`;
      setNodes((current) => [
        ...current,
        {
          id,
          type: "promptNode",
          position,
          data: {
            role: template.role,
            label: template.label,
            listItems: [createListItem("", 1)],
            content: ""
          }
        }
      ]);
      setSelectedNodeId(id);
    },
    [instance, setNodes]
  );

  const enrichedNodeTypes = useMemo(
    () => ({
      promptNode: (props) => (
        <PromptNode
          {...props}
          isSelected={props.id === selectedNodeId}
          onSelect={() => setSelectedNodeId(props.id)}
          onChange={(patch) => updateNodeData(props.id, patch)}
          onListChange={(nextItems) => updateNodeList(props.id, nextItems)}
        />
      )
    }),
    [selectedNodeId, updateNodeData]
  );

  const promptOutput = useMemo(() => buildPromptOutput(nodes, edges), [nodes, edges]);
  const selectedNode = nodes.find((n) => n.id === selectedNodeId) ?? null;

  const removeSelectedNode = () => {
    if (!selectedNodeId) {
      return;
    }
    setNodes((current) => current.filter((n) => n.id !== selectedNodeId));
    setEdges((current) =>
      current.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
  };

  const getPromptContent = () =>
    promptOutput.structuredPrompt?.trim() ? promptOutput.structuredPrompt : "No prompt steps yet.";

  const copyPromptToClipboard = async () => {
    const content = getPromptContent();
    try {
      await navigator.clipboard.writeText(content);
      window.alert("Prompt copied to clipboard.");
    } catch {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "absolute";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        window.alert("Prompt copied to clipboard.");
      } catch {
        window.alert("Failed to copy prompt. Please copy it manually.");
      }
    }
  };

  const downloadPromptAsMarkdown = () => {
    const content = getPromptContent();
    const markdown = `# Generated Prompt\n\n${content}\n`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `prompt-flow-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.md`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const runAiGeneration = async () => {
    if (!apiKey.trim()) {
      setGenerationError("API key is required.");
      return;
    }
    if (!generatorPrompt.trim()) {
      setGenerationError("Please describe the flow you want to generate.");
      return;
    }

    setIsGenerating(true);
    setGenerationError("");
    setGeneratedGraph(null);

    const systemInstruction = [
      "You are an assistant that converts instructions into prompt-flow JSON.",
      "Return JSON only. No markdown.",
      "Schema:",
      JSON.stringify(
        {
          nodes: [{ id: "string", role: "system | user | assistant", label: "string", content: "string" }],
          edges: [{ from: "string", to: "string" }]
        },
        null,
        2
      ),
      "Rules:",
      ...AI_RULES.map((rule, index) => `${index + 1}. ${rule}`)
    ].join("\n");

    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model: "gpt-4.1-mini",
          input: [
            { role: "system", content: [{ type: "input_text", text: systemInstruction }] },
            { role: "user", content: [{ type: "input_text", text: generatorPrompt.trim() }] }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "prompt_flow_graph",
              schema: FLOW_SCHEMA,
              strict: true
            }
          }
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI request failed (${response.status}): ${errText}`);
      }

      const payload = await response.json();
      const rawText =
        payload.output_text ||
        payload.output?.map((item) => item?.content?.map((c) => c?.text || "").join("")).join("") ||
        "";

      const parsed = extractJsonObject(rawText);
      const validationError = validateGeneratedGraph(parsed);
      if (validationError) {
        throw new Error(validationError);
      }
      setGeneratedGraph(parsed);
    } catch (error) {
      setGenerationError(error.message || "Failed to generate flow.");
    } finally {
      setIsGenerating(false);
    }
  };

  const drawGeneratedFlow = () => {
    if (!generatedGraph) {
      return;
    }
    const validationError = validateGeneratedGraph(generatedGraph);
    if (validationError) {
      setGenerationError(validationError);
      return;
    }
    const { rfNodes, rfEdges } = layoutGraph(generatedGraph);
    setNodes(rfNodes);
    setEdges(rfEdges);
    setSelectedNodeId(rfNodes[0]?.id ?? null);
    setIsAiModalOpen(false);
  };

  useEffect(() => {
    try {
      window.localStorage.setItem(
        FLOW_STORAGE_KEY,
        JSON.stringify({
          nodes,
          edges,
          selectedNodeId
        })
      );
    } catch {
      // Ignore localStorage failures (quota, privacy mode, etc.)
    }
  }, [nodes, edges, selectedNodeId]);

  const importPromptToFlow = () => {
    const shouldContinue = window.confirm(
      "Importing will replace the current canvas nodes and edges. Do you want to continue?"
    );
    if (!shouldContinue) {
      return;
    }

    const parsed = parsePromptTextToGraph(importPromptText);
    if (parsed.error) {
      setImportError(parsed.error);
      return;
    }
    const validationError = validateGeneratedGraph(parsed.graph);
    if (validationError) {
      setImportError(validationError);
      return;
    }
    const { rfNodes, rfEdges } = layoutGraph(parsed.graph);
    setNodes(rfNodes);
    setEdges(rfEdges);
    setSelectedNodeId(rfNodes[0]?.id ?? null);
    setImportError("");
    setIsImportModalOpen(false);
  };

  const onImportFileSelected = async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const isMarkdown = /\.md$/i.test(file.name) || file.type === "text/markdown" || file.type === "text/plain";
    if (!isMarkdown) {
      setImportError("Please upload a valid .md file.");
      event.target.value = "";
      return;
    }

    try {
      const text = await file.text();
      setImportPromptText(text);
      setImportError("");
    } catch {
      setImportError("Failed to read file content.");
    } finally {
      event.target.value = "";
    }
  };

  const resetAllNodes = () => {
    const shouldReset = window.confirm(
      "Are you sure you want to delete all nodes and edges? This action cannot be undone."
    );
    if (!shouldReset) {
      return;
    }
    setNodes([]);
    setEdges([]);
    setSelectedNodeId(null);
  };

  const applyLayout = () => {
    setNodes((current) => autoLayoutNodes(current, edges, layoutMode));
    if (instance) {
      setTimeout(() => instance.fitView({ padding: 0.2, duration: 350 }), 0);
    }
  };

  return (
    <div
      className={`layout ${leftPanelCollapsed ? "left-collapsed" : ""} ${rightPanelCollapsed ? "right-collapsed" : ""}`.trim()}
    >
      {!leftPanelCollapsed ? (
        <aside className="left-panel">
        <h1>Prompt Flow Designer</h1>
        <p className="subtle">Drag node types into the canvas and connect them to build a prompt workflow.</p>
        <button type="button" className="open-ai-btn" onClick={() => setLeftPanelCollapsed(true)}>
          Collapse Left Menu
        </button>
        <button type="button" className="open-ai-btn" onClick={() => setIsAiModalOpen(true)}>
          Open AI Flow Generator
        </button>
        <button
          type="button"
          className="open-ai-btn"
          onClick={() => {
            setImportError("");
            setIsImportModalOpen(true);
          }}
        >
          Import Prompt To Nodes
        </button>
        <button type="button" className="danger reset-all-btn" onClick={resetAllNodes}>
          Reset All Nodes
        </button>
        <div className="node-editor">
          <h2>Layout</h2>
          <label>
            Layout Mode
            <select value={layoutMode} onChange={(event) => setLayoutMode(event.target.value)}>
              <option value="vertical">Vertical Flow</option>
              <option value="horizontal">Horizontal Flow</option>
              <option value="grid">Grid</option>
            </select>
          </label>
          <button type="button" className="open-ai-btn" onClick={applyLayout}>
            Apply Layout
          </button>
        </div>
        <div className="palette">
          {TEMPLATE_NODES.map((template) => (
            <button
              key={template.role}
              className="palette-item"
              draggable
              onDragStart={(event) => onDragStart(event, template)}
              type="button"
            >
              <strong>{template.label}</strong>
              <span>{template.hint}</span>
            </button>
          ))}
        </div>

        <div className="node-editor">
          <h2>Selected Node</h2>
          {selectedNode ? (
            <>
              <label>
                Label
                <input
                  value={selectedNode.data.label}
                  onChange={(event) =>
                    updateNodeData(selectedNode.id, { label: event.target.value })
                  }
                />
              </label>
              <label>
                Role
                <select
                  value={selectedNode.data.role}
                  onChange={(event) =>
                    updateNodeData(selectedNode.id, { role: event.target.value })
                  }
                >
                  {TEMPLATE_NODES.map((nodeType) => (
                    <option key={nodeType.role} value={nodeType.role}>
                      {nodeType.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Content
                <p className="subtle">Edit numbered items directly inside the node on the canvas.</p>
              </label>
              <button type="button" className="danger" onClick={removeSelectedNode}>
                Delete Node
              </button>
            </>
          ) : (
            <p className="subtle">Click a node to edit it.</p>
          )}
        </div>
        </aside>
      ) : null}

      <main className="canvas-panel">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={enrichedNodeTypes || nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={setInstance}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={(_, node) => setSelectedNodeId(node.id)}
          fitView
        >
          <Background gap={20} size={1} color="rgba(0, 0, 0, 0.12)" />
          <MiniMap pannable zoomable />
          <Controls />
          <Panel position="top-right" className="flow-help">
            Drop new nodes from the left panel
          </Panel>
          <Panel position="top-left" className="flow-help panel-toggle-group">
            <button
              type="button"
              className="panel-toggle-btn"
              onClick={() => setLeftPanelCollapsed((current) => !current)}
            >
              {leftPanelCollapsed ? "Show Left Menu" : "Hide Left Menu"}
            </button>
            <button
              type="button"
              className="panel-toggle-btn"
              onClick={() => setRightPanelCollapsed((current) => !current)}
            >
              {rightPanelCollapsed ? "Show Right Menu" : "Hide Right Menu"}
            </button>
          </Panel>
        </ReactFlow>
      </main>

      {!rightPanelCollapsed ? (
        <aside className="right-panel">
        <button type="button" className="open-ai-btn" onClick={() => setRightPanelCollapsed(true)}>
          Collapse Right Menu
        </button>
        <h2>Generated Prompt</h2>
        <p className="subtle">Derived from graph connectivity and node order.</p>
        <div className="modal-actions">
          <button type="button" className="export-btn" onClick={copyPromptToClipboard}>
            Copy Prompt
          </button>
          <button type="button" className="open-ai-btn" onClick={downloadPromptAsMarkdown}>
            Download Prompt (.md)
          </button>
        </div>
        <pre style={{ maxHeight: "400px", overflow: "auto" }}>
          {promptOutput.structuredPrompt || "No prompt steps yet."}
        </pre>
        <h3>Structured JSON</h3>
        <pre style={{ maxHeight: "400px", overflow: "auto" }}>
          {JSON.stringify(promptOutput.graph, null, 2)}
        </pre>
        </aside>
      ) : null}

      {isAiModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsAiModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>ChatGPT API Flow Generator</h2>
            <p className="subtle">Set your API key, describe the desired flow, generate JSON, then draw it.</p>
            <label>
              OpenAI API Key
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-..."
              />
            </label>
            <label>
              Generation Prompt
              <textarea
                rows={7}
                value={generatorPrompt}
                onChange={(event) => setGeneratorPrompt(event.target.value)}
                placeholder="Example: Build a support triage flow with greeting, issue collection, and troubleshooting branch."
              />
            </label>

            <div className="modal-actions">
              <button type="button" className="export-btn" onClick={runAiGeneration} disabled={isGenerating}>
                {isGenerating ? "Generating..." : "Generate JSON"}
              </button>
              <button
                type="button"
                className="open-ai-btn"
                onClick={drawGeneratedFlow}
                disabled={!generatedGraph}
              >
                Draw Flow From JSON
              </button>
            </div>

            {generationError ? <p className="error-text">{generationError}</p> : null}
            {generatedGraph ? (
              <pre className="modal-json-preview">{JSON.stringify(generatedGraph, null, 2)}</pre>
            ) : null}
          </div>
        </div>
      ) : null}

      {isImportModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsImportModalOpen(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <h2>Import Prompt To Nodes</h2>
            <p className="subtle">
              Paste prompt text. Supported formats: <code>[1] SYSTEM ...</code> blocks or
              <code>system: ...</code> lines, roadmap outlines like <code>Project Setup</code> + <code>1.1 ...</code>,
              parent-child format <code>[1] SYSTEM</code> + <code>1.1 ...</code>, and JSON graph format with <code>nodes</code>/<code>edges</code>.
            </p>
            <label>
              Upload Markdown (.md)
              <input type="file" accept=".md,text/markdown,text/plain" onChange={onImportFileSelected} />
            </label>
            <label>
              Prompt Text
              <textarea
                rows={12}
                value={importPromptText}
                onChange={(event) => setImportPromptText(event.target.value)}
                placeholder={"Project Setup\n1.1 Initialize Vite + React + TypeScript.\n1.2 Install dependencies."}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="export-btn" onClick={importPromptToFlow}>
                Import and Draw Flow
              </button>
              <button type="button" className="open-ai-btn" onClick={() => setIsImportModalOpen(false)}>
                Cancel
              </button>
            </div>
            {importError ? <p className="error-text">{importError}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <FlowDesigner />
    </ReactFlowProvider>
  );
}
