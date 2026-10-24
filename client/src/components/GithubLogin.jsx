export const GithubLogin = ({ onSuccess, onError }) => {
  const handleClick = () => {
    const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID;
    const redirectUri = window.location.origin + "/auth/github/callback";
    const state = Math.random().toString(36).substring(7);

    const githubUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=user:email&state=${state}`;

    const width = 500;
    const height = 600;
    const left = window.screen.width / 2 - width / 2;
    const top = window.screen.height / 2 - height / 2;

    const popup = window.open(
      githubUrl,
      "GitHub Login",
      `width=${width},height=${height},top=${top},left=${left}`,
    );

    if (!popup) {
      onError?.(new Error("GitHub login popup was blocked."));
      return;
    }

    const handleMessage = async (event) => {
      if (event.origin !== window.location.origin) return;

      if (event.data.type === "GITHUB_AUTH_CODE") {
        window.removeEventListener("message", handleMessage);
        const { code } = event.data;
        onSuccess(code);
      }
    };

    window.addEventListener("message", handleMessage);
  };

  return (
    <button
      onClick={handleClick}
      type="button"
      style={{
        width: "300px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        padding: "10px",
        border: "1px solid #747474",
        borderRadius: "50px",
        backgroundColor: "var(--card-bg)",
        color: "var(--text-primary)",
        cursor: "pointer",
        fontSize: "14px",
        fontWeight: "500",
        textDecoration: "none",
      }}
    >
      <svg height="20" width="20" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
      </svg>
      Continue with GitHub
    </button>
  );
};
