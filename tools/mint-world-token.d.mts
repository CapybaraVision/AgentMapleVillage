export function mintWorldToken(options?: {
  rootToken?: string;
  rootFile?: string;
  relay?: string;
  state?: string;
  villageId?: string;
  map?: string;
  outDir?: string;
}): Promise<{
  villageId: string;
  worldTokenLen: number;
  refreshTokenLen: number;
  worldTokenExpiresAt: number;
  refreshTokenExpiresAt: number;
  worldFile: string;
  refreshFile: string;
  backup: string;
}>;
