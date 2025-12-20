import { BaseNode } from './BaseNode';

export const nodeTypes = {
  agent: BaseNode,
  shell: BaseNode,
  trigger: BaseNode,
  workdir: BaseNode,
};

export type { BaseNodeData, NodeType, ExecutionStatus } from './BaseNode';
