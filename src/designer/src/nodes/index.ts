import { BaseNode } from './BaseNode';

export const nodeTypes = {
  agent: BaseNode,
  shell: BaseNode,
  script: BaseNode,
  trigger: BaseNode,
  workdir: BaseNode,
  component: BaseNode,
  'interface-input': BaseNode,
  'interface-output': BaseNode,
  loop: BaseNode,
  'interface-continue': BaseNode,
};

export type { BaseNodeData, NodeType, ExecutionStatus } from './BaseNode';
