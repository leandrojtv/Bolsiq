import { ImageResponse } from "next/og";
import { valorDoToken } from "@/lib/tokens";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";
export const dynamic = "force-static";

/** Favicon: o "B" do logo, nas cores dos tokens. */
export default function Icone() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        borderRadius: 8,
        background: valorDoToken("accent"),
        color: valorDoToken("on-accent"),
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 22,
        fontWeight: 700,
      }}
    >
      B
    </div>,
    size,
  );
}
