/**
 * Name:      Notes (sticky) Extension for GNOME
 * Version:   1.0
 * Created:   17.03.2025
 * URL:       https://github.com/shoaibzs/
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'use strict';

// Import GNOME libraries
import * as Clutter from 'gi://Clutter';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as ShellEntry from 'resource:///org/gnome/shell/ui/shellEntry.js';
import * as GrabHelper from 'resource:///org/gnome/shell/ui/grabHelper.js';
import Pango from 'gi://Pango';
import * as Shell from 'gi://Shell';
import * as Meta from 'gi://Meta';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

import * as Menus from './menus.js';
import Dialog from './dialog.js';

import GObject from 'gi://GObject';

// Path to store notes data
const PATH = GLib.build_filenamev([GLib.get_user_data_dir(), 'notes_data']);

const MIN_HEIGHT = 75;
const MIN_WIDTH = 200;

function stringFromArray(data) {
	// Modern approach for GNOME 45+ that doesn't use ByteArray
	if (data instanceof Uint8Array) {
		return new TextDecoder().decode(data);
	}
	return data.toString();
}

export const NoteBox = GObject.registerClass({
	GTypeName: 'NoteBox'
}, class NoteBox extends St.BoxLayout {
	
	constructor(id, colorString, fontSize, extension, manager) {
		// Initialize the St.BoxLayout with our desired properties
		super({
			reactive: true,
			vertical: true,
			min_height: MIN_HEIGHT,
			min_width: MIN_WIDTH,
			style_class: 'noteBoxStyle',
			track_hover: true,
		});

		this.id = id;
		this._extension = extension;
		this._manager = manager;
		this._fontSize = fontSize || 12;
		this._isBold = false; // Add bold state
		
		// Store the initial color but don't apply it yet
		// We'll apply it after loading state or use this as default
		this.customColor = colorString || '245,176,65';
		this._fontColor = '';
		this.entry_is_visible = true;
		
		// Initialize position and dimensions with default values
		this._width = 250;
		this._height = 180;
		
		// Set initial position - this will be overridden by _loadState if a saved position exists
		[this._x, this._y] = this._computeRandomPosition();
		
		// Create the menu first, before building the note
		this._addMenu();
		
		// Then build the note which will use the menu
		this._buildNote();
		
		// Load saved state (position, size, color, etc.)
		this._loadState();
		
		// Load text content
		this._loadText();
		
		// Add to the correct layer
		this.loadIntoCorrectLayer();
	}

	_addMenu() {
		this._menu = new Menus.NoteOptionsMenu(this, this._extension);
	}

	_buildNote() {
		// Don't apply style here, we'll do it after loading state
		this._buildHeaderbar();
		this._buildNoteContent();
		this._setupEventHandlers();

		this.grabX = 0;
		this.grabY = 0;
	}

	_buildNoteContent() {
		this._scrollView = new St.ScrollView({
			overlay_scrollbars: true,
			x_expand: true,
			y_expand: true,
			clip_to_allocation: true,
		});

		this.noteEntry = new St.Entry({
			name: 'noteEntry',
			can_focus: true,
			hint_text: "Type here...",
			track_hover: true,
			x_expand: true,
			style_class: 'notesTextField',
		});

		const clutterText = this.noteEntry.get_clutter_text();
		clutterText.set_single_line_mode(false);
		clutterText.set_activatable(false);
		clutterText.set_line_wrap(true);
		clutterText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);

		this._entryBox = new St.BoxLayout({
			reactive: true,
			x_expand: true,
			y_expand: true,
			visible: this.entry_is_visible,
		});

		this._entryBox.add_child(this.noteEntry);
		this._scrollView.add_child(this._entryBox);
		this.add_child(this._scrollView);
	}

	_setupEventHandlers() {
		this._grabHelper = new GrabHelper.GrabHelper(this.noteEntry);
		
		// Always use button-press-event for focus
		this.noteEntry.connect('button-press-event', this._getKeyFocus.bind(this));
		this.noteEntry.connect('leave-event', this._leaveKeyFocus.bind(this));
		
		this.connect('notify::hover', this._applyActorStyle.bind(this));
	}

	_buildHeaderbar() {
		this._buttonsBox = new St.BoxLayout({
			vertical: false,
			visible: true,
			reactive: true,
			x_expand: true,
			y_expand: false,
			style_class: 'noteHeaderStyle',
		});

		this._addHeaderButtons();
		this._setupHeaderHandlers();
		this.add_child(this._buttonsBox);
	}

	_addHeaderButtons() {
		const buttons = [
			{
				icon: 'list-add-symbolic',
				tooltip: "New",
				callback: this._createNote.bind(this)
			},
			{
				icon: 'format-text-bold-symbolic',
				tooltip: "Toggle bold",
				callback: this.toggleBold.bind(this)
			},
			{
				icon: 'user-trash-symbolic',
				tooltip: "Delete",
				callback: this._openDeleteDialog.bind(this)
			}
		];

		for (const btn of buttons) {
			const button = new Menus.NoteRoundButton(this, btn.icon, btn.tooltip);
			button.actor.connect('clicked', btn.callback);
			this._buttonsBox.add_child(button.actor);
		}

		this.moveBox = new St.Button({
			x_expand: true,
			style_class: 'notesTitleButton'
		});
		this._buttonsBox.add_child(this.moveBox);

		// Ensure the menu exists before creating the options button
		if (this._menu) {
			const optionsBtn = new Menus.NoteRoundButton(
				this,
				'view-more-symbolic',
				"Note options"
			);
			optionsBtn.addMenu();
			this._buttonsBox.add_child(optionsBtn.actor);
		} else {
			log('Notes Extension: Warning - menu is undefined in _addHeaderButtons');
		}

		const resizeBtn = new Menus.NoteRoundButton(
			this,
			'view-fullscreen-symbolic',
			"Resize"
		);
		this._buttonsBox.add_child(resizeBtn.actor);
		this._resizeButton = resizeBtn.actor;
	}

	_setupHeaderHandlers() {
		this.moveBox.connect('button-press-event', this._onMovePress.bind(this));
		this.moveBox.connect('motion-event', this._onMoveMotion.bind(this));
		this.moveBox.connect('button-release-event', this._onRelease.bind(this));

		this._resizeButton.connect('button-press-event', this._onResizePress.bind(this));
		this._resizeButton.connect('motion-event', this._onResizeMotion.bind(this));
		this._resizeButton.connect('button-release-event', this._onRelease.bind(this));
	}

	_openDeleteDialog() {
		Dialog.showConfirm("Delete note", "Are you sure you want to delete this note?", () => {
			this._deleteNoteObject();
		});
	}

	_initStyle() {
		// Parse the color string and apply it
		const [r, g, b] = this.customColor.split(',').map(Number);
		this._applyColor(r, g, b);
	}

	loadIntoCorrectLayer() {
		// Ensure dimensions are valid before adding to layout
		this._width = Math.max(this._width || 250, MIN_WIDTH);
		this._height = Math.max(this._height || 180, MIN_HEIGHT);
		this.set_size(this._width, this._height);
		
		// Ensure position is valid
		if (isNaN(this._x) || isNaN(this._y)) {
			log(`Notes Extension: Invalid position when loading into layer, fixing`);
			[this._x, this._y] = this._computeRandomPosition();
		}
		
		// Apply position before adding to layer
		this._setNotePosition();

		// Always add to the background layer
		if (Main.layoutManager._backgroundGroup) {
			Main.layoutManager._backgroundGroup.add_child(this);
		} else {
			// Fallback for older GNOME versions
			const backgroundActor = Main.layoutManager.uiGroup.get_children().find(
				child => child.constructor.name === 'BackgroundGroup'
			);
			if (backgroundActor) {
				backgroundActor.add_child(this);
			} else {
				// Last resort fallback
				Main.layoutManager.uiGroup.add_child(this);
			}
		}
		
		// Apply position again after adding to layer to ensure it's correct
		this._setNotePosition();
	}

	removeFromCorrectLayer() {
		try {
			// Always remove from parent, regardless of which layer it was in
			const parent = this.get_parent();
			if (parent) {
				parent.remove_child(this);
			}
		} catch (e) {
			log(`Notes Extension: Error removing note from layer: ${e}`);
		}
	}

	show() {
		super.show();
		const parent = this.get_parent();
		if (parent) {
			parent.set_child_above_sibling(this, null);
		}
	}

	onlyHide() {
		super.hide();
	}

	onlySave(withMetadata=true) {
		if(withMetadata) {
			this._saveState();
		}
		this._saveText();
	}

	fixState() {
		let outX = (this._x < 0 || this._x > Main.layoutManager.primaryMonitor.width - 20);
		let outY = (this._y < 0 || this._y > Main.layoutManager.primaryMonitor.height - 20);
		if (outX || outY) {
			[this._x, this._y] = this._computeRandomPosition();
			this._setNotePosition();
		}
		if (Number.isNaN(this._x)) { this._x = 10; }
		if (Number.isNaN(this._y)) { this._y = 10; }
		if (Number.isNaN(this.width)) { this.width = 250; }
		if (Number.isNaN(this.height)) { this.height = 200; }
		if (Number.isNaN(this._fontSize)) { this._fontSize = 10; }
		this._saveState();
	}

	_applyActorStyle() {
		let is_hovered = this.hover;
		let temp;
		if (is_hovered) {
			temp = 'background-color: rgba(' + this.customColor + ', 0.8);';
		} else {
			temp = 'background-color: rgba(' + this.customColor + ', 0.6);';
		}
		if(this._fontColor != '') {
			temp += 'color: ' + this._fontColor + ';';
		}
		this.style = temp;
		// Also apply to the buttons box to ensure consistent color
		if (this._buttonsBox) {
			this._buttonsBox.style = temp;
		}
	}

	_applyNoteStyle() {
		let temp = 'background-color: rgba(' + this.customColor + ', 0.8);';
		if(this._fontColor != '') {
			temp += 'color: ' + this._fontColor + ';';
		}
		if(this._fontSize != 0) {
			temp += 'font-size: ' + this._fontSize + 'px;';
		}
		if(this._isBold) {
			temp += 'font-weight: bold;';
		}
		// Add default font family
		temp += 'font-family: Cantarell, sans-serif;';
		this.noteEntry.style = temp;
		// Also apply to the entry box to ensure consistent color
		this._entryBox.style = temp;
	}

	_getKeyFocus() {
		if (this.entry_is_visible) {
			this._grabHelper.grab({ actor: this.noteEntry });
			this.noteEntry.grab_key_focus();
		}
		this._redraw();
	}

	_leaveKeyFocus() {
		this._grabHelper.ungrab({ actor: this.noteEntry });
	}

	_redraw() {
		const parent = this.get_parent();
		if (parent) {
			parent.set_child_above_sibling(this, null);
		}
		this.onlySave();
	}

	_setNotePosition() {
		let monitor = Main.layoutManager.primaryMonitor;
		if (!monitor) {
			log('Notes Extension: No primary monitor found, cannot set position');
			return;
		}

		// Ensure dimensions are valid
		this._width = Math.max(this._width || 250, MIN_WIDTH);
		this._height = Math.max(this._height || 180, MIN_HEIGHT);
		
		// Update size
		this.set_size(this._width, this._height);

		// Check if position is valid
		if (isNaN(this._x) || isNaN(this._y)) {
			log(`Notes Extension: Invalid position (${this._x}, ${this._y}), using random position`);
			[this._x, this._y] = this._computeRandomPosition();
		}

		// Ensure position is within monitor bounds
		const oldX = this._x;
		const oldY = this._y;
		
		this._x = Math.max(0, Math.min(this._x, monitor.width - this._width));
		this._y = Math.max(0, Math.min(this._y, monitor.height - this._height));
		
		// Log if position was adjusted
		if (oldX !== this._x || oldY !== this._y) {
			log(`Notes Extension: Adjusted position from (${oldX}, ${oldY}) to (${this._x}, ${this._y})`);
		}

		// Set position
		this.set_position(
			monitor.x + Math.floor(this._x),
			monitor.y + Math.floor(this._y)
		);
	}

	_onMovePress(actor, event) {
		let mouseButton = event.get_button();
		if (mouseButton == 3) {
			this._entryBox.visible = !this._entryBox.visible;
			this.entry_is_visible = this._entryBox.visible;
		}
		this._onPressCommon(event);
		this._isMoving = true;
		this._isResizing = false;
	}

	_onResizePress(actor, event) {
		this._onPressCommon(event);
		this._isResizing = true;
		this._isMoving = false;
	}

	_onPressCommon(event) {
		this._redraw();
		this.grabX = Math.floor(event.get_coords()[0]);
		this.grabY = Math.floor(event.get_coords()[1]);
	}

	_onResizeMotion(actor, event) {
		if (!this._isResizing) { return; }
		let x = Math.floor(event.get_coords()[0]);
		let y = Math.floor(event.get_coords()[1]);
		this._resizeTo(x, y);
	}

	_resizeTo(event_x, event_y) {
		let newWidth = Math.abs(this.width + (event_x - this.grabX));
		let newHeight = Math.abs(this._y + this.height - event_y + (this.grabY - this._y));
		let newY = event_y - (this.grabY - this._y);

		// Ensure minimum dimensions
		newWidth = Math.max(newWidth, MIN_WIDTH);
		newHeight = Math.max(newHeight, MIN_HEIGHT);

		// Update internal state
		this._width = newWidth;
		this._height = newHeight;

		// Apply to actor
		this.set_size(this._width, this._height);
		this._y = newY;
		this._setNotePosition();

		this.grabX = event_x;
		this.grabY = event_y;
	}

	_onMoveMotion(actor, event) {
		if (!this._isMoving) { return; }
		let x = Math.floor(event.get_coords()[0]);
		let y = Math.floor(event.get_coords()[1]);
		this._moveTo(x, y);
	}

	_moveTo(event_x, event_y) {
		let newX = event_x - (this.grabX - this._x);
		let newY = event_y - (this.grabY - this._y);

		this._y = Math.floor(newY);
		this._x = Math.floor(newX);
		this._setNotePosition();

		this.grabX = event_x;
		this.grabY = event_y;
	}

	_onRelease(actor, event) {
		this._isResizing = false;
		this._isMoving = false;
		// Save state when releasing to ensure position/size is saved
		this._saveState();
		this._saveText();
	}

	changeFontSize(delta) {
		if (this._fontSize + delta > 1) {
			this._fontSize += delta;
			this._applyNoteStyle();
		}
		this.onlySave();
	}

	applyColorAndSave(r, g, b) {
		this._applyColor(r, g, b);
		// Explicitly save state after color change
		this._saveState();
	}

	_createNote() {
		this._manager.createNote(this.customColor, this._fontSize);
	}

	_applyColor(r, g, b) {
		if (Number.isNaN(r)) r = 255;
		if (Number.isNaN(g)) g = 255;
		if (Number.isNaN(b)) b = 255;
		r = Math.min(Math.max(0, r), 255);
		g = Math.min(Math.max(0, g), 255);
		b = Math.min(Math.max(0, b), 255);
		this.customColor = r.toString() + ',' + g.toString() + ',' + b.toString();
		if (r + g + b > 250) {
			this._fontColor = '#000000';
		} else {
			this._fontColor = '#ffffff';
		}
		this._applyNoteStyle();
		this._applyActorStyle();
		this._saveState(); // Save state immediately when color changes
	}

	_loadText() {
		const filePath = GLib.build_filenamev([PATH, this.id.toString() + '_text']);
		if (!GLib.file_test(filePath, GLib.FileTest.EXISTS)) {
			GLib.file_set_contents(filePath, '');
		}

		try {
			const [success, contents] = GLib.file_get_contents(filePath);
			if (!success) {
				log('Could not read file: ' + filePath);
				return;
			}
			const content = stringFromArray(contents);
			this.noteEntry.set_text(content);
		} catch (e) {
			log(`Notes Extension: Error loading text file: ${e}`);
		}
	}

	_saveText() {
		try {
			let noteText = this.noteEntry.get_text() || '';
			let file = GLib.build_filenamev([PATH, `${this.id}_text`]);
			if (!GLib.file_set_contents(file, noteText)) {
				log(`Notes Extension: Failed to save text to ${file}`);
			}
		} catch (e) {
			log(`Notes Extension: Error saving text file: ${e}`);
		}
	}

	_computeRandomPosition() {
		let x;
		let y;
		for(let i = 0; i < 15; i++) {
			x = Math.random() * (Main.layoutManager.primaryMonitor.width - 300);
			y = Math.random() * (Main.layoutManager.primaryMonitor.height - 100);

			if (this._manager.areCoordsUsable(x, y)) {
				return [x, y];
			}
		}
		return [x, y];
	}

	_createDefaultState(filePath) {
		try {
			const defaultPosition = this._computeRandomPosition();
			const defaultState = {
				x: defaultPosition[0],
				y: defaultPosition[1],
				color: this.customColor,
				width: 250,
				height: 180,
				fontSize: this._fontSize,
				entryVisible: true,
				isBold: false
			};

			const stateFile = Gio.File.new_for_path(filePath);
			const stateStream = stateFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
			const stateWriter = new Gio.DataOutputStream({
				base_stream: stateStream,
				close_base_stream: true
			});
			
			stateWriter.put_string(JSON.stringify(defaultState), null);
			stateWriter.close(null);
			
			return defaultState;
		} catch (e) {
			log(`Notes Extension: Error creating default state: ${e}`);
			return null;
		}
	}

	_loadState() {
		const stateFilePath = GLib.build_filenamev([PATH, `${this.id}_state`]);
		if (!GLib.file_test(stateFilePath, GLib.FileTest.EXISTS)) {
			// If no state file exists, create default state and apply initial style
			this._createDefaultState(stateFilePath);
			this._initStyle();
			return;
		}

		try {
			const stateFile = Gio.File.new_for_path(stateFilePath);
			const [success, contents] = stateFile.load_contents(null);
			
			if (!success) {
				log(`Notes Extension: Could not read state file: ${stateFilePath}`);
				this._createDefaultState(stateFilePath);
				this._initStyle();
				return;
			}

			const stateData = JSON.parse(contents.toString());
			
			// Apply color first
			if (stateData.color) {
				this.customColor = stateData.color;
			}
			
			// Apply other state values
			this._width = Math.max(Number(stateData.width) || 250, MIN_WIDTH);
			this._height = Math.max(Number(stateData.height) || 180, MIN_HEIGHT);
			this._fontSize = Number(stateData.fontSize) || 12;
			this._x = Number(stateData.x);
			this._y = Number(stateData.y);
			this.entry_is_visible = stateData.entryVisible !== false;
			this._isBold = stateData.isBold || false;

			// Ensure position values are valid
			if (isNaN(this._x) || isNaN(this._y)) {
				log(`Notes Extension: Invalid position values in state file, using random position`);
				[this._x, this._y] = this._computeRandomPosition();
			}
			
			// Apply dimensions to actor
			this.set_size(this._width, this._height);
			
			// Apply position immediately
			this._setNotePosition();
			
			// Apply style after loading state
			this._initStyle();
			
			// Log state for debugging
			log(`Notes Extension: Loaded note ${this.id} at position (${this._x}, ${this._y}) with color ${this.customColor}`);
		} catch (e) {
			log(`Notes Extension: Error loading state file: ${e}`);
			// Set default values
			[this._x, this._y] = this._computeRandomPosition();
			this._width = 250;
			this._height = 180;
			this.entry_is_visible = true;
			this._isBold = false;
			
			// Apply default dimensions to actor
			this.set_size(this._width, this._height);
			
			// Apply position immediately
			this._setNotePosition();
			
			// Apply default style
			this._initStyle();
		}
	}

	_saveState() {
		try {
			// Ensure position values are valid before saving
			if (isNaN(this._x) || isNaN(this._y)) {
				log(`Notes Extension: Invalid position values, fixing before saving`);
				[this._x, this._y] = this._computeRandomPosition();
				this._setNotePosition();
			}
			
			// Save state data in JSON format
			const stateData = {
				x: Math.floor(this._x),
				y: Math.floor(this._y),
				color: this.customColor,
				width: this._width,
				height: this._height,
				fontSize: this._fontSize,
				entryVisible: this.entry_is_visible,
				isBold: this._isBold
			};

			const stateFilePath = GLib.build_filenamev([PATH, `${this.id}_state`]);
			const stateFile = Gio.File.new_for_path(stateFilePath);
			const stateStream = stateFile.replace(null, false, Gio.FileCreateFlags.NONE, null);
			const stateWriter = new Gio.DataOutputStream({
				base_stream: stateStream,
				close_base_stream: true
			});
			
			stateWriter.put_string(JSON.stringify(stateData), null);
			stateWriter.close(null);
			
			log(`Notes Extension: Saved note ${this.id} at position (${this._x}, ${this._y}) with color ${this.customColor}`);
		} catch (e) {
			log(`Notes Extension: Error saving state file: ${e}`);
		}
	}

	_deleteNoteObject() {
		try {
			// Remove from array
			if (this._manager && this._manager._allNotes) {
				const index = this._manager._allNotes.indexOf(this);
				if (index > -1) {
					this._manager._allNotes.splice(index, 1);
				}
			}
			
			// Delete the files
			const textFilePath = GLib.build_filenamev([PATH, `${this.id}_text`]);
			const stateFilePath = GLib.build_filenamev([PATH, `${this.id}_state`]);
			
			// Delete text file if it exists
			if (GLib.file_test(textFilePath, GLib.FileTest.EXISTS)) {
				const textFile = Gio.File.new_for_path(textFilePath);
				textFile.delete(null);
			}
			
			// Delete state file if it exists
			if (GLib.file_test(stateFilePath, GLib.FileTest.EXISTS)) {
				const stateFile = Gio.File.new_for_path(stateFilePath);
				stateFile.delete(null);
			}
			
			// Destroy the note
			this.destroy();
		} catch (e) {
			log(`Notes Extension: Error deleting note: ${e}`);
		}
	}

	destroy() {
		// Disconnect all signals first
		this.disconnectAll();
		
		// Release grab helper if it exists
		if (this._grabHelper) {
			this._grabHelper.ungrab();
			this._grabHelper = null;
		}
		
		// Remove from layer
		this.removeFromCorrectLayer();
		
		// Call parent destroy
		super.destroy();
	}
	
	disconnectAll() {
		// Disconnect all signals to prevent callbacks after destruction
		try {
			// Store all signal IDs we need to disconnect
			const signalsToDisconnect = [];
			
			// Disconnect header button signals
			if (this.moveBox) {
				// Instead of using disconnect_all_signal_handlers which doesn't exist,
				// we need to manually disconnect each signal
				this.moveBox.disconnect_all_signals = false; // Prevent further signals
			}
			
			if (this._resizeButton) {
				this._resizeButton.disconnect_all_signals = false; // Prevent further signals
			}
			
			// Disconnect note entry signals
			if (this.noteEntry) {
				this.noteEntry.disconnect_all_signals = false; // Prevent further signals
			}
			
			// For the main object, we can't disconnect all signals easily
			// but we can set a flag to ignore future signals
			this._isBeingDestroyed = true;
		} catch (e) {
			log(`Notes Extension: Error disconnecting signals: ${e}`);
		}
	}

	toggleBold() {
		this._isBold = !this._isBold;
		this._applyNoteStyle();
		this._saveState();
	}
});

export { stringFromArray }

