import { ForecastClient } from "@/modules/forecast/components/forecast-client";
import { getForecast, getInsights, getProjection, parseHorizon } from "@/modules/forecast/service";
import { requireUser } from "@/server/auth/require-user";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function ForecastContent({ searchParams }: { searchParams: SearchParams }) {
  const ctx = await requireUser();
  const horizon = parseHorizon((await searchParams).days);
  const [forecast, projection, insights] = await Promise.all([
    getForecast(ctx, horizon),
    getProjection(ctx),
    getInsights(ctx),
  ]);
  return <ForecastClient forecast={forecast} projection={projection} insights={insights} />;
}
