import { Node } from "prosemirror-model";
import { Plugin, PluginKey, Transaction } from "prosemirror-state";
import { findBlockNodes } from "prosemirror-utils";
import { Decoration, DecorationSet } from "prosemirror-view";
import { v4 as uuidv4 } from "uuid";
import MoveCanvasModule from "diagram-js/lib/navigation/movecanvas"
import ZoomScrollModule from "diagram-js/lib/navigation/zoomscroll"

type BPMNState = {
  decorationSet: DecorationSet;
  diagramVisibility: Record<number, boolean>;
  isDark: boolean;
};

function getNewState({
  doc,
  name,
  pluginState,
}: {
  doc: Node;
  name: string;
  pluginState: BPMNState;
}) {
  const decorations: Decoration[] = [];

  // Find all blocks that represent BPMN diagrams
  const blocks: { node: Node; pos: number }[] = findBlockNodes(doc).filter(
    (item) =>
      item.node.type.name === name && item.node.attrs.language === "bpmnjs"
  );

  blocks.forEach((block) => {
    const diagramDecorationPos = block.pos + block.node.nodeSize;
    const existingDecorations = pluginState.decorationSet.find(
      block.pos,
      diagramDecorationPos
    );

    // Attempt to find the existing diagramId from the decoration, or assign
    // a new one if none exists yet.
    let diagramId = existingDecorations[0]?.spec["diagramId"];
    if (diagramId === undefined) {
      diagramId = uuidv4();
    }

    // Make the diagram visible by default if it contains source code
    if (pluginState.diagramVisibility[diagramId] === undefined) {
      pluginState.diagramVisibility[diagramId] = !!block.node.textContent;
    }

    const diagramDecoration = Decoration.widget(
      block.pos + block.node.nodeSize,
      () => {
        const elementId = "bpmn-diagram-wrapper-" + diagramId;
        const element =
          document.getElementById(elementId) || document.createElement("div");
        element.id = elementId;
        element.classList.add("bpmn-diagram-wrapper");

        if (pluginState.diagramVisibility[diagramId] === false) {
          element.classList.add("diagram-hidden");
          return element;
        } else {
          element.classList.remove("diagram-hidden");
        }

        import("bpmn-js/lib/Viewer").then((module) => {
          var viewer = new module.default({
            width: '100%',
            height: '100%',
            additionalModules: [
              MoveCanvasModule,
              ZoomScrollModule
            ]
          });

          viewer.detach()

          element.innerHTML = ''

          viewer.attachTo(element)

          viewer.importXML(block.node.textContent).then(function (result) {

            const { warnings } = result;

            console.log('success !', warnings);

            var viewbox = viewer.get('canvas').viewbox();

            var wRate = element.offsetWidth / viewbox.inner.width;

            if (wRate > 1) {
              element.style.height = (viewbox.inner.height + 50) + 'px'
            } else {
              element.style.height = ((viewbox.inner.height * wRate) + 50) + 'px'
            }

            viewer.get('canvas').zoom('fit-viewport');

          }).catch(function (err) {

            const { warnings, message } = err;

            console.log('something went wrong:', warnings, message);
          });


        })

        return element;

      },
      {
        diagramId,
      }
    );

    const attributes = { "data-diagram-id": "" + diagramId };
    if (pluginState.diagramVisibility[diagramId] !== false) {
      attributes["class"] = "code-hidden";
    }

    const diagramIdDecoration = Decoration.node(
      block.pos,
      block.pos + block.node.nodeSize,
      attributes,
      {
        diagramId,
      }
    );

    decorations.push(diagramDecoration);
    decorations.push(diagramIdDecoration);
  });

  return {
    decorationSet: DecorationSet.create(doc, decorations),
    diagramVisibility: pluginState.diagramVisibility,
    isDark: pluginState.isDark,
  };
}

export default function BPMN({
  name,
  isDark,
}: {
  name: string;
  isDark: boolean;
}) {
  let diagramShown = false;

  return new Plugin({
    key: new PluginKey("bpmn"),
    state: {
      init: (_: Plugin, { doc }) => {
        const pluginState: BPMNState = {
          decorationSet: DecorationSet.create(doc, []),
          diagramVisibility: {},
          isDark,
        };
        return pluginState;
      },
      apply: (
        transaction: Transaction,
        pluginState: BPMNState,
        oldState,
        state
      ) => {
        const nodeName = state.selection.$head.parent.type.name;
        const previousNodeName = oldState.selection.$head.parent.type.name;
        const codeBlockChanged =
          transaction.docChanged && [nodeName, previousNodeName].includes(name);
        const ySyncEdit = !!transaction.getMeta("y-sync$");
        const bpmnMeta = transaction.getMeta("bpmn");
        const themeMeta = transaction.getMeta("theme");
        const diagramToggled = bpmnMeta?.toggleDiagram !== undefined;
        const themeToggled = themeMeta?.isDark !== undefined;

        if (themeToggled) {
          pluginState.isDark = themeMeta.isDark;
        }

        if (diagramToggled) {
          pluginState.diagramVisibility[
            bpmnMeta.toggleDiagram
          ] = !pluginState.diagramVisibility[bpmnMeta.toggleDiagram];
        }

        if (
          !diagramShown ||
          themeToggled ||
          codeBlockChanged ||
          diagramToggled ||
          ySyncEdit
        ) {
          diagramShown = true;
          return getNewState({
            doc: transaction.doc,
            name,
            pluginState,
          });
        }

        return {
          decorationSet: pluginState.decorationSet.map(
            transaction.mapping,
            transaction.doc
          ),
          diagramVisibility: pluginState.diagramVisibility,
          isDark: pluginState.isDark,
        };
      },
    },
    view: (view) => {
      if (!diagramShown) {
        // we don't draw diagrams on code blocks on the first render as part of mounting
        // as it's expensive (relative to the rest of the document). Instead let
        // it render without a diagram and then trigger a defered render of BPMN
        // by updating the plugins metadata
        setTimeout(() => {
          view.dispatch(view.state.tr.setMeta("bpmn", { loaded: true }));
        }, 10);
      }

      return {};
    },
    props: {
      decorations(state) {
        return this.getState(state).decorationSet;
      },
    },
  });
}
