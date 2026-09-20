export type Request = { from: string; subject: string; body: string };

export type Action =
  | { type: "Agent"; args: [Request] }
  | { type: "Human"; args: [Request] }
  | { type: "SelfServe"; args: [Request] };

export async function agent(request: Request): Promise<Action> {
  return { type: "Agent", args: [request] };
}

export async function human(request: Request): Promise<Action> {
  return { type: "Human", args: [request] };
}

export async function selfServe(request: Request): Promise<Action> {
  return { type: "SelfServe", args: [request] };
}
