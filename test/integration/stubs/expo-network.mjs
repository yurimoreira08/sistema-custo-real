const online = !!process.env.SYNC_CAPTURE;
export async function getNetworkStateAsync() { return { isConnected: online, isInternetReachable: online }; }
