// import fetch from "node-fetch";
export const handler = async () => {
  try {
    console.log("==== handler");
    const result = await fetch("https://api.ipify.org?format=json", {
      method: "GET",
    });
    const json = await result.json();
    console.log("==== status", result.status);
    console.log("==== json", json);
  } catch (error) {
    console.error(error);
  }
};
