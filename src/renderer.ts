import path from "path";
import { Dsl } from "./dsl";
import { tmpdir } from "os";
import { Notice } from "obsidian";
import { Settings } from "./settings";
import { existsSync, promises as fs } from "fs";

export class Renderer {
    static render(
        args: Dsl,
        settings: Settings,
        el: HTMLElement,
        vault_root: string
    ) {
        const { height, width, equations, hash } = args;

        const cache_dir = settings.cache_directory
            ? path.isAbsolute(settings.cache_directory)
                ? settings.cache_directory
                : path.join(vault_root, settings.cache_directory)
            : tmpdir();

        const cache_target = path.join(cache_dir, `desmos-graph-${hash}.png`);

        // If this graph is in the cache then fetch it
        if (settings.cache && existsSync(cache_target)) {
            fs.readFile(cache_target).then((data) => {
                const b64 =
                    "data:image/png;base64," +
                    Buffer.from(data).toString("base64");
                const img = document.createElement("img");
                img.src = b64;
                el.appendChild(img);
            });
            return;
        }

        const expressions = equations.map(
            (equation) =>
                `calculator.setExpression({ latex: "${equation.replace(
                    "\\",
                    "\\\\"
                )}" });`
        );

        // Because of the electron sandboxing we have to do this inside an iframe,
        // otherwise we can't include the desmos API (although it would be nice if they had a REST API of some sort)
        const html_src_head = `<script src="https://www.desmos.com/api/v1.6/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6"></script>`;
        const html_src_body = `
            <div id="calculator" style="width: ${width}px; height: ${height}px;"></div>
            <script>
                const options = {
                    settingsMenu: false,
                    expressions: false,
                    lockViewPort: true,
                    zoomButtons: false,
                    trace: false,
                };

                const calculator = Desmos.GraphingCalculator(document.getElementById("calculator"), options);
                ${expressions.join("")}

                calculator.asyncScreenshot({ showLabels: true, format: "png" }, (data) => {
                    document.body.innerHTML = "";
                    parent.postMessage({ t: "desmos-graph", data }, "app://obsidian.md");                    
                });
            </script>
        `;
        const html_src = `<html><head>${html_src_head}</head><body>${html_src_body}</body>`;

        const iframe = document.createElement("iframe");
        iframe.width = width;
        iframe.height = height;
        iframe.style.border = "none";
        iframe.scrolling = "no"; // fixme use a non-depreciated function
        iframe.srcdoc = html_src;
        // iframe.style.display = "none"; //fixme hiding the iframe breaks the positioning

        el.appendChild(iframe);

        const handler = (
            message: MessageEvent<{ t: string; data: string }>
        ) => {
            if (
                message.origin === "app://obsidian.md" &&
                message.data.t === "desmos-graph"
            ) {
                const { data } = message.data;
                window.removeEventListener("message", handler);

                const img = document.createElement("img");
                img.src = data;
                el.empty();
                el.appendChild(img);

                if (settings.cache) {
                    if (existsSync(cache_dir)) {
                        fs.writeFile(
                            cache_target,
                            data.replace(/^data:image\/png;base64,/, ""),
                            "base64"
                        ).catch(
                            (err) =>
                                new Notice(
                                    `desmos-graph: unexpected error when trying to cache graph: ${err}`,
                                    10000
                                )
                        );
                    } else {
                        new Notice(
                            `desmos-graph: cache directory not found: '${cache_dir}'`,
                            10000
                        );
                    }
                }
            }
        };

        window.addEventListener("message", handler);
    }
}
