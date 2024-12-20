const modelMap = {
  "gpt-4": "gemini-1.5-pro-latest",
  "gpt-4o": "gemini-2.0-flash-exp",
  "gpt-4o-mini": "gemini-2.0-flash-exp",
  "o1-preview": "gemini-2.0-flash-thinking-exp"
};

const modelsList = [
  {
    created: 1677610602,
    object: "model",
    owned_by: "google",
    id: "gemini-2.0-flash-thinking-exp",
  },
  {
    created: 1677610602,
    object: "model",
    owned_by: "google",
    id: "gemini-2.0-flash-exp",
  },
  {
    created: 1677610602,
    object: "model",
    owned_by: "google",
    id: "gemini-1.5-pro-latest",
  },
  {
    created: 1677610602,
    object: "model",
    owned_by: "google",
    id: "gemini-1.5-flash-latest",
  }
];

export { modelsList, modelMap };
