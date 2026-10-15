import type { DecrementStock, StrategyName } from "../../types";
import * as atomic from "./atomic";
import * as pessimistic from "./pessimistic";
import * as naive from "./naive";

// Strategy pattern: every strategy exposes the same DecrementStock
export const strategies: Record<StrategyName, { decrementStock: DecrementStock }> = {
  atomic,
  pessimistic,
  naive,
};
