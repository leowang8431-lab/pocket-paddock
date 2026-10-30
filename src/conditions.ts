export type WeatherMode = 'sunny' | 'rainy';
export function isWeatherMode(value:unknown):value is WeatherMode{return value==='sunny'||value==='rainy';}

/** Arcade wet-weather tyres. These are gameplay values, not measured F1 data. */
export const WEATHER_PHYSICS={
  sunny:{grip:1,braking:1,acceleration:1,response:1},
  rainy:{grip:.68,braking:.74,acceleration:.9,response:.84},
} as const;
