export type Lead = { company: string; employees: number; source: string };

export type Action =
  | { type: "Pursue"; args: [Lead] }
  | { type: "Nurture"; args: [Lead] }
  | { type: "Disqualify"; args: [Lead] };

export async function pursue(lead: Lead): Promise<Action> {
  return { type: "Pursue", args: [lead] };
}

export async function nurture(lead: Lead): Promise<Action> {
  return { type: "Nurture", args: [lead] };
}

export async function disqualify(lead: Lead): Promise<Action> {
  return { type: "Disqualify", args: [lead] };
}
