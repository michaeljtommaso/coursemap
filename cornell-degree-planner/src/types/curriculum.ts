export type NodeStatus = "locked" | "available" | "planned" | "completed" | "waived";
export type NodeType = "course" | "bucket" | "milestone";
export type EdgeType = "prerequisite" | "corequisite" | "recommended";

export type RequirementNode = {
  id: string;
  code?: string;
  title: string;
  type: NodeType;
  credits?: number;
  semesterHint: number;
  description: string;
  categories: string[];
  offered?: string;
  prereqNodeIds?: string[];
  coreqNodeIds?: string[];
};

export type RequirementEdge = {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
};

export type ProgramMap = {
  institution: string;
  college: string;
  program: string;
  catalogYear: string;
  nodes: RequirementNode[];
  edges: RequirementEdge[];
};
