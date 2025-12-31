import { BaseEdge, getSmoothStepPath } from '@xyflow/react';
import type { EdgeProps } from '@xyflow/react';
import './AnimatedEdge.css';

export interface AnimatedEdgeData {
  executionCount: number;
  isAnimating: boolean;
  [key: string]: unknown;  // Allow additional properties for Record<string, unknown> compatibility
}

export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  markerEnd,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  // Cast data to our expected type
  const edgeData = data as AnimatedEdgeData | undefined;
  const executionCount = edgeData?.executionCount ?? 0;
  const isAnimating = edgeData?.isAnimating ?? false;

  return (
    <>
      {/* Base edge */}
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd as string | undefined} />

      {/* Execution count badge */}
      {executionCount > 0 && (
        <foreignObject
          x={labelX - 12}
          y={labelY - 12}
          width={24}
          height={24}
          className="edge-count-badge"
        >
          <div className={`edge-count ${isAnimating ? 'animate' : ''}`}>
            {executionCount}
          </div>
        </foreignObject>
      )}

      {/* Animated dot traveling along edge */}
      {isAnimating && (
        <circle r={4} fill="#3b82f6" className="edge-dot">
          <animateMotion dur="0.4s" repeatCount="1" path={edgePath} />
        </circle>
      )}
    </>
  );
}
