import { observer } from "mobx-react-lite";
import HQ from "../hq";
import { useEffect } from "react";

const Share = observer(() => {
  useEffect(() => {

  }, [])

  return <div className="flex flex-col h-[100vh] w-full bg-secondbackground" >
    <HQ />
  </div>
});

export default Share