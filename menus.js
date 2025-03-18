/**
 * Name:      Notes (sticky) Extension for GNOME
 *              This file handles the menus and buttons for the notes extension.
 *              It provides the popup menu for note options and the round buttons in the note header.
 * Version:   1.0
 * Created:   17.03.2025
 * URL:       https://github.com/shoaibzs/
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'use strict';

// Import GNOME libraries
import * as Clutter from 'gi://Clutter';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as ShellEntry from 'resource:///org/gnome/shell/ui/shellEntry.js';
import * as Util from 'resource:///org/gnome/shell/misc/util.js';
import GObject from 'gi://GObject';
import * as Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Gio from 'gi://Gio';
import * as Meta from 'gi://Meta';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// Import our own modules
import * as NoteBox from './noteBox.js';
import Dialog from './dialog.js';

/**
 * Preset colors for notes
 * 
 * Defines a set of predefined colors that users can choose from
 * for their notes. Each color is defined as an RGB array.
 */
const PRESET_COLORS = {
	'red': [200, 0, 0],
	'green': [0, 150, 0],
	'blue': [0, 0, 180],

	'magenta': [255, 50, 255],
	'yellow': [255, 255, 50],
	'cyan': [0, 255, 255],

	'white': [255, 255, 255],
	'black': [50, 50, 50]
};

//------------------------------------------------------------------------------

/**
 * Menu class
 * 
 * Handles the creation and management of menus for note operations.
 */
class Menu {
	/**
	 * Create a new menu
	 * 
	 * @param {NoteBox.NoteBox} note - The note this menu belongs to
	 * @returns {PopupMenu.PopupMenu} - The created menu
	 */
	static create(note) {
		const menu = new PopupMenu.PopupMenu(note, 0.5, St.Side.TOP);
		menu.addMenuItem(new PopupMenu.PopupMenuItem("Delete note", {
			activate: () => {
				Dialog.showConfirm("Delete note", "Are you sure you want to delete this note?", () => {
					note.delete();
				});
			}
		}));
		menu.addMenuItem(new PopupMenu.PopupMenuItem("Change color", {
			activate: () => {
				note.changeColor();
			}
		}));
		menu.addMenuItem(new PopupMenu.PopupMenuItem("Change font size", {
			activate: () => {
				note.changeFontSize();
			}
		}));
		return menu;
	}
}

export default Menu;

//------------------------------------------------------------------------------

/**
 * NoteOptionsMenu class
 * 
 * Provides a popup menu with options for a note.
 * This menu allows users to change the note's color and font size.
 */
export class NoteOptionsMenu extends PopupMenu.PopupMenu {
	/**
	 * Create a new note options menu
	 * 
	 * @param {object} note - The note object this menu belongs to
	 * @param {object} extension - The extension object
	 */
	constructor(note, extension) {
		super(note, 0.5, St.Side.LEFT);
		this._note = note;
		this._extension = extension;

		// Add menu to UI group
		Main.uiGroup.add_child(this.actor);
		this.actor.hide();

		this._buildMenu();
	}

	/**
	 * Build the menu with all options
	 * 
	 * Creates the color and font size submenus with their respective options.
	 */
	_buildMenu() {
		let item;

		// Color submenu
		let colorSubMenu = new PopupMenu.PopupSubMenuMenuItem("Color");
		this.addMenuItem(colorSubMenu);

		const colors = [
			{ label: "Red", rgb: [240, 80, 80] },
			{ label: "Green", rgb: [100, 200, 100] },
			{ label: "Blue", rgb: [90, 90, 255] },
			{ label: "Yellow", rgb: [255, 180, 60] },
			{ label: "Purple", rgb: [200, 100, 200] },
			{ label: "Gray", rgb: [150, 150, 150] },
			{ label: "White", rgb: [255, 255, 255] }
		];

		// Add each color option to the submenu
		for (const color of colors) {
			item = new PopupMenu.PopupMenuItem(color.label);
			item.connect('activate', () => {
				this._note.applyColorAndSave(...color.rgb);
			});
			colorSubMenu.menu.addMenuItem(item);
		}

		// Size submenu
		let sizeSubMenu = new PopupMenu.PopupSubMenuMenuItem("Font size");
		this.addMenuItem(sizeSubMenu);

		const sizes = [
			{ label: "Decrease", delta: -2 },
			{ label: "Increase", delta: +2 }
		];

		// Add font size options to the submenu
		for (const size of sizes) {
			item = new PopupMenu.PopupMenuItem(size.label);
			item.connect('activate', () => {
				this._note.changeFontSize(size.delta);
			});
			sizeSubMenu.menu.addMenuItem(item);
		}
	}
}

//------------------------------------------------------------------------------

/**
 * NoteRoundButton class
 * 
 * Provides round buttons for the note header.
 * These buttons allow users to perform actions like creating a new note,
 * deleting a note, accessing options, and resizing.
 */
export class NoteRoundButton {
	/**
	 * Create a new round button
	 * 
	 * @param {object} note - The note object this button belongs to
	 * @param {string} icon_name - The icon name to use for the button
	 * @param {string} tooltip_text - The tooltip text to show on hover
	 */
	constructor(note, icon_name, tooltip_text) {
		this._note = note;
		this.actor = new St.Button({
			reactive: true,
			can_focus: true,
			track_hover: true,
			accessible_name: tooltip_text,
			style_class: 'notesButton',
		});

		// Create and add the icon to the button
		const icon = new St.Icon({
			icon_name: icon_name,
			style_class: 'system-status-icon',
			icon_size: 16,
		});
		this.actor.set_child(icon);
	}

	/**
	 * Add a menu to the button
	 * 
	 * Used for the options button to show the options menu when clicked.
	 */
	addMenu() {
		// Get the menu from the note
		this.menu = this._note._menu;
		
		// Ensure the menu exists before proceeding
		if (!this.menu) {
			log('Notes Extension: Error - menu is undefined in NoteRoundButton.addMenu()');
			return;
		}
		
		this.actor.menu = this.menu;
		this.actor.connect('clicked', () => this._onMenuButtonPress());
	}

	/**
	 * Handle menu button press
	 * 
	 * Toggles the menu visibility when the button is clicked.
	 */
	_onMenuButtonPress() {
		// Check if menu exists before trying to toggle it
		if (!this.menu) {
			log('Notes Extension: Error - menu is undefined in NoteRoundButton._onMenuButtonPress()');
			return;
		}
		
		this.menu.toggle();
		if (this.menu.isOpen) {
			this.actor.add_style_pseudo_class('active');
		} else {
			this.actor.remove_style_pseudo_class('active');
		}
	}

	/**
	 * Clean up resources when the button is destroyed
	 */
	destroy() {
		if (this.menu) {
			this.menu.destroy();
			this.menu = null;
		}
		
		if (this.actor) {
			this.actor.destroy();
			this.actor = null;
		}
	}
}

