import { BaseNode } from './BaseNode';
import { LoopContainerNode } from './LoopContainerNode';
import { ConstantNode } from './ConstantNode';
import { WireNode } from './WireNode';

export const nodeTypes = {
  agent: BaseNode,
  shell: BaseNode,
  script: BaseNode,
  trigger: BaseNode,
  workdir: BaseNode,
  component: BaseNode,
  'interface-input': BaseNode,
  'interface-output': BaseNode,
  loop: LoopContainerNode,
  'interface-continue': BaseNode,
  constant: ConstantNode,
  function: BaseNode,
  wire: WireNode,
};

export type { BaseNodeData, NodeType, ExecutionStatus } from './BaseNode';
export type { ConstantNodeData } from './ConstantNode';
export type { WireNodeData } from './WireNode';
