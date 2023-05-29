import {MODULE_ID} from "../main.js";
import { generateDescription } from "../systems.js";

export class CombatantPortrait {
    constructor(combatant) {
        this.combatant = combatant;
        this.actor = combatant.actor;
        this.token = combatant.token?.object;
        this.combat = combatant.combat;
        this.element = document.createElement("div");
        this.element.classList.add("combatant-portrait");
        this.element.setAttribute("data-combatant-id", combatant.id);
        this.element.setAttribute("data-tooltip-class", "combat-dock-tooltip");
        this.resolve = null;
        this.ready = new Promise((res) => (this.resolve = res));
        this.activateListeners();
        this.renderInner();
    }

    get img() {
        const useActor = game.settings.get(MODULE_ID, "portraitImage") === "actor";
        return (useActor ? this.combatant.actor?.img : this.combatant.img) ?? this.combatant.img;
    }

    activateListeners() {
        //add left and right click and double click listeners
        this.element.addEventListener("click", this._onClick.bind(this));
        this.element.addEventListener("dblclick", this._onDoubleClick.bind(this));
        //add hover in and out listeners
        this.element.addEventListener("mouseenter", this._onHoverIn.bind(this));
        this.element.addEventListener("mouseleave", this._onHoverOut.bind(this));
    }

    _onClick(event) {
        if(!this.token) return;
        const isLeftClick = event.button === 0;
        const isRightClick = event.button === 2;
        if (isLeftClick) this.token._onClickLeft(event);
        else if (isRightClick) this.token._onClickRight(event);
    }

    _onDoubleClick(event) {
        if(!this.token) return;
        const isLeftClick = event.button === 0;
        const isRightClick = event.button === 2;
        if (isLeftClick) this.token._onClickLeft2(event);
        else if (isRightClick) this.token._onClickRight2(event);
    }

    _onHoverIn(event) {
        if(!this.token) return;
        this.token._onHoverIn(event);
    }

    _onHoverOut(event) {
        if(!this.token) return;
        this.token._onHoverOut(event);
    }

    async renderInner() {
        const data = await this.getData();
        this.element.classList.toggle("hidden", !data);
        if (!data) {
            this.element.innerHTML = "";
            return;
        }
        const template = await renderTemplate("modules/combat-tracker-dock/templates/combatant-portrait.hbs", { ...data });
        const tooltip = await renderTemplate("modules/combat-tracker-dock/templates/combatant-tooltip.hbs", { ...data });
        this.element.innerHTML = template;
        this.element.setAttribute("data-tooltip", tooltip);
        this.element.classList.toggle("active", data.css.includes("active"));
        this.element.classList.toggle("visible", data.css.includes("hidden"));
        this.element.classList.toggle("defeated", data.css.includes("defeated"));
        this.element.style.borderBottomColor = this.getBorderColor(this.token.document);
        this.element.querySelector(".roll-initiative").addEventListener("click", async (event) => {
            event.preventDefault();
            Hooks.once("renderCombatTracker", () => { 
                ui.combatDock.updateOrder()
            });
            await this.combatant.combat.rollInitiative([this.combatant.id]);
        });
        this.element.querySelectorAll(".action").forEach((action) => {
            action.addEventListener("click", async (event) => {
                event.stopPropagation();
                event.stopImmediatePropagation();
                const dataAction = action.dataset.action;
                switch (dataAction) {
                    case "toggle-hidden":
                        await this.combatant.update({hidden: !this.combatant.hidden})
                        break;
                    case "toggle-defeated":
                        await ui.combat._onToggleDefeatedStatus(this.combatant);
                        break;
                    case "ping":
                        await ui.combat._onPingCombatant(this.combatant);
                        break;
                }
            });
        });
        this.resolve(true);
    }

    getResource(resource = null) {
        if (!this.actor || !this.combat) return null;

        resource = resource ?? this.combat.settings.resource;

        let max, value, percentage;

        if(!resource) { max, value, percentage };

        max = foundry.utils.getProperty(this.actor.system, resource + ".max") ?? foundry.utils.getProperty(this.actor.system, resource.replace("value", "") + "max");

        value = foundry.utils.getProperty(this.actor.system, resource) ?? foundry.utils.getProperty(this.actor.system, resource + ".value");

        if (max !== undefined && value !== undefined) percentage = Math.round((value / max) * 100);

        return { max, value, percentage };
    }

    getData() {
        // Format information about each combatant in the encounter
        let hasDecimals = false;
        const combatant = this.combatant;
        if (!combatant.visible && !game.user.isGM) return null;
        const trackedAttributes = game.settings.get(MODULE_ID, "attributes").map((a) => {
            const resourceData = this.getResource(a.attr);
            const iconHasExtension = a.icon.includes(".");
            return {
                ...resourceData,
                icon: iconHasExtension ? `<img src="${a.icon}" />` : `<i class="${a.icon} icon"></i>`,
                units: a.units || "",
            };
        });
        // Prepare turn data
        const hasPermission = (combatant.actor?.permission ?? -10) >= CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER || combatant.isOwner;
        const resource = hasPermission ? this.getResource() : null;
        const turn = {
            id: combatant.id,
            name: combatant.name,
            img: this.img,
            active: this.combat.turns.indexOf(combatant) === this.combat.turn,
            owner: combatant.isOwner,
            isGM: game.user.isGM,
            defeated: combatant.isDefeated,
            hidden: combatant.hidden,
            initiative: combatant.initiative,
            hasRolled: combatant.initiative !== null,
            hasResource: resource !== null,
            hasPlayerOwner: combatant.actor?.hasPlayerOwner,
            hasPermission: hasPermission,
            showInitiative: game.settings.get(MODULE_ID, "showInitiativeOnPortrait"),
            isInitiativeNaN: isNaN(combatant.initiative) || combatant.initiative === null || combatant.initiative === undefined,
            resource: resource,
            canPing: combatant.sceneId === canvas.scene?.id && game.user.hasPermission("PING_CANVAS"),
            attributes: trackedAttributes,
            description: getDescription(combatant.actor),
        };
        if (turn.initiative !== null && !Number.isInteger(turn.initiative)) hasDecimals = true;
        turn.css = [turn.active ? "active" : "", turn.hidden ? "hidden" : "", turn.defeated ? "defeated" : ""].join(" ").trim();

        // Actor and Token status effects
        turn.effects = new Set();
        if (combatant.token) {
            combatant.token.effects.forEach((e) =>
                turn.effects.add({
                    icon: e,
                    label: CONFIG.statusEffects.find((s) => s.icon === e)?.name ?? "",
                }),
            );
            if (combatant.token.overlayEffect) turn.effects.add(combatant.token.overlayEffect);
        }
        turn.hasAttributes = trackedAttributes.length > 0;
        if (combatant.actor) {
            for (const effect of combatant.actor.temporaryEffects) {
                if (effect.statuses.has(CONFIG.specialStatusEffects.DEFEATED)) turn.defeated = true;
                else if (effect.icon) turn.effects.add({ icon: effect.icon, label: effect.name });
            }
        }
        
        turn.hasEffects = turn.effects.size > 0;
        // Format initiative numeric precision
        const precision = CONFIG.Combat.initiative.decimals;
        if (turn.hasRolled) turn.initiative = turn.initiative.toFixed(hasDecimals ? precision : 0);

        return turn;
    }

    getBorderColor(tokenDocument) {
        if(!game.settings.get(MODULE_ID, "showDispositionColor")) return "#000";
        let color;
        const d = tokenDocument.disposition;
        const colors = CONFIG.Canvas.dispositionColors;
        if (!game.user.isGM && this.isOwner) color = colors.CONTROLLED;
        else if (this.actor?.hasPlayerOwner) color = colors.PARTY;
        else if (d === CONST.TOKEN_DISPOSITIONS.FRIENDLY) color = colors.FRIENDLY;
        else if (d === CONST.TOKEN_DISPOSITIONS.NEUTRAL) color =  colors.NEUTRAL;
        else if (d === CONST.TOKEN_DISPOSITIONS.HOSTILE) color =  colors.HOSTILE;
        else if (d === CONST.TOKEN_DISPOSITIONS.SECRET && this.isOwner) color =  colors.SECRET;
        else color = colors.NEUTRAL;
        color = new Color(color).toString();
        return color;
    }

    destroy() {
        this.element?.remove();
    }
}

function getDescription(actor) {

    let description = null;

    try {
        description = generateDescription(actor);
    }catch(e) {
        console.error(e);
    }

    return description;
}