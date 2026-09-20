export type Ticket = { message: string };

export type Action =
  | { type: "Escalate"; args: [Ticket] }
  | { type: "Refund"; args: [Ticket] }
  | { type: "Reply"; args: [string] };

export async function escalate(ticket: Ticket): Promise<Action> {
  return { type: "Escalate", args: [ticket] };
}

export async function refund(ticket: Ticket): Promise<Action> {
  return { type: "Refund", args: [ticket] };
}

export async function reply(message: string): Promise<Action> {
  return { type: "Reply", args: [message] };
}
