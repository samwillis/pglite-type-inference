import { useEffect, useState } from "react";
import { PGlite } from "@electric-sql/pglite";
import migration1 from "../migrations/1-create-tables.sql?raw";
import "./App.css";
import { PGliteWithTypes } from "./pglite-types.gen";

let dbPromise = PGlite.create();

dbPromise.then((db) => {
  db.exec(migration1);
});

function App() {
  const [db, setDb] = useState<PGliteWithTypes | null>(null);

  useEffect(() => {
    dbPromise.then(setDb);
  }, []);

  const handleInsert = () => {
    const res = db?.query(
      `INSERT INTO people (id, name, age, city) VALUES ($1, $2, $3, $4)`,
      [1, "John Doe", 10, "New York"]
    );
    console.log(res);
  };

  const handleQuery = async () => {
    const res = await db?.query("SELECT name, city, age FROM people WHERE city = $1", ["london"]);
    console.log(res);
  };

  return (
    <>
      <button onClick={handleInsert}>Insert</button>
      <button onClick={handleQuery}>Query</button>
    </>
  );
}

export default App;
