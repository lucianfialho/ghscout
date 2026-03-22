export interface RepoMeta {
  owner: string;
  repo: string;
  fullName: string;
  stars: number;
  pushedAt: string;
  topics: string[];
  language: string | null;
  description: string;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  reactions: {
    thumbsUp: number;
    thumbsDown: number;
    total: number;
  };
  commentsCount: number;
  createdAt: string;
  htmlUrl: string;
  user: string;
  state: string;
}

export interface Pull {
  number: number;
  title: string;
  merged: boolean;
  mergedAt: string | null;
  reactions: {
    thumbsUp: number;
    thumbsDown: number;
    total: number;
  };
  htmlUrl: string;
  user: string;
  createdAt: string;
}

export interface FetchOptions {
  limit?: number;
  period?: string;
  state?: string;
}
