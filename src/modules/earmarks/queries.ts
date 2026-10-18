import "server-only";

// Read side for Server Components (accounts list/detail; dashboard cards in Phase 4).
export {
  getAccountBuckets,
  getBuckets,
  getBucketsInBase,
  listAccountBuckets,
} from "@/modules/earmarks/service";
