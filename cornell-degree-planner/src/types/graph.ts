export type CategoryProgressItem = {
  category: string;
  total: number;
  completed: number;
};

export type PlannerWarning = {
  id: string;
  type: "prerequisite" | "credit" | "advisory";
  message: string;
};
