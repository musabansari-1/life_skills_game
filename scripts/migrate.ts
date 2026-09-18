/** Apply pending migrations to DATABASE_URL. `pnpm db:migrate` */
import "dotenv/config";
import { getDb } from "../src/db/client";

getDb()
  .then(() => {
    console.log("Migrations applied.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
