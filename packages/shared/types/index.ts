export interface Intent {
  agentId: bigint;
  actionType: 'OPEN_POSITION' | 'CLOSE_POSITION' | 'MODIFY_POSITION';
  params: string; // ABI-encoded
}
