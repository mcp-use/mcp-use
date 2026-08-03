import { createProxyExample } from "./server.js";

function getPort(): number {
  const value = process.env["PORT"] ?? "3000";
  const port = value.trim() === "" ? Number.NaN : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      `PORT must be an integer from 0 to 65535; received ${value}`
    );
  }
  return port;
}

const example = await createProxyExample();

try {
  const address = await example.server.listen(getPort());
  console.log(`Proxy gateway: ${address.url}`);
  console.log(
    "Tools: gateway_status, weather_forecast, inventory_find_product"
  );

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      resolve();
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
} finally {
  await example.close();
}
