import { useState, useEffect } from "react";
import Home          from "./pages/Home";
import History       from "./pages/History";
import FloatingTimer from "./FloatingTimer";

function useRouter() {
  const getPage = () => {
    const p = window.location.pathname.replace("/","") || "home";
    return ["home","history"].includes(p) ? p : "home";
  };
  const [page, setPage] = useState(getPage);
  const navigate = (to) => {
    window.history.pushState(null, "", to === "home" ? "/" : "/" + to);
    setPage(to);
    window.scrollTo(0, 0);
  };
  useEffect(() => {
    const h = () => setPage(getPage());
    window.addEventListener("popstate", h);
    return () => window.removeEventListener("popstate", h);
  }, []);
  return { page, navigate };
}

export default function App() {
  const { page, navigate } = useRouter();
  return (
    <>
      {page === "home"    && <Home    navigate={navigate} />}
      {page === "history" && <History navigate={navigate} />}
      <FloatingTimer navigate={navigate} />
    </>
  );
}