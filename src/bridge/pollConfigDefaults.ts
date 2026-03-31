

const POLL_INTERVAL_MS_NOT_AT_CAPACITY = 2000

const POLL_INTERVAL_MS_AT_CAPACITY = 600_000

const MULTISESSION_POLL_INTERVAL_MS_NOT_AT_CAPACITY =
  POLL_INTERVAL_MS_NOT_AT_CAPACITY
const MULTISESSION_POLL_INTERVAL_MS_PARTIAL_CAPACITY =
  POLL_INTERVAL_MS_NOT_AT_CAPACITY
const MULTISESSION_POLL_INTERVAL_MS_AT_CAPACITY = POLL_INTERVAL_MS_AT_CAPACITY

export type PollIntervalConfig = {
  poll_interval_ms_not_at_capacity: number
  poll_interval_ms_at_capacity: number
  non_exclusive_heartbeat_interval_ms: number
  multisession_poll_interval_ms_not_at_capacity: number
  multisession_poll_interval_ms_partial_capacity: number
  multisession_poll_interval_ms_at_capacity: number
  reclaim_older_than_ms: number
  session_keepalive_interval_v2_ms: number
}

export const DEFAULT_POLL_CONFIG: PollIntervalConfig = {
  poll_interval_ms_not_at_capacity: POLL_INTERVAL_MS_NOT_AT_CAPACITY,
  poll_interval_ms_at_capacity: POLL_INTERVAL_MS_AT_CAPACITY,
  
  
  
  
  
  
  
  non_exclusive_heartbeat_interval_ms: 0,
  multisession_poll_interval_ms_not_at_capacity:
    MULTISESSION_POLL_INTERVAL_MS_NOT_AT_CAPACITY,
  multisession_poll_interval_ms_partial_capacity:
    MULTISESSION_POLL_INTERVAL_MS_PARTIAL_CAPACITY,
  multisession_poll_interval_ms_at_capacity:
    MULTISESSION_POLL_INTERVAL_MS_AT_CAPACITY,
  
  
  
  
  reclaim_older_than_ms: 5000,
  
  
  
  
  session_keepalive_interval_v2_ms: 120_000,
}
