export type Post = { body: string };

export type Action =
  | { type: "Allow"; args: [Post] }
  | { type: "Remove"; args: [Post, string] }
  | { type: "Review"; args: [Post] };

export async function allow(post: Post): Promise<Action> {
  return { type: "Allow", args: [post] };
}

export async function remove(post: Post, reason: string): Promise<Action> {
  return { type: "Remove", args: [post, reason] };
}

export async function review(post: Post): Promise<Action> {
  return { type: "Review", args: [post] };
}
