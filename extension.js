/**
 * Name:      Notes (sticky) Extension for GNOME
 * This extension provides sticky notes functionality for the GNOME desktop.
 * Users can create, edit, delete, and customize notes that appear on the desktop.
 * The extension uses ESM (ECMAScript modules) and is compatible with GNOME 45-48.
 * Version:   1.0
 * Created:   17.03.2025
 * URL:       https://github.com/shoaibzs/
 * SPDX-License-Identifier: GPL-2.0-or-later
 */

'use strict';

// Import GNOME libraries
import St from 'gi://St';
import * as Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import * as Gio from 'gi://Gio';
import * as Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

// Import our own modules
import * as NoteBox from './noteBox.js';

// Path to store notes data
const PATH = GLib.build_filenamev([GLib.get_user_data_dir(), 'notes_data']);

/**
 * Main extension class
 * 
 * Handles extension lifecycle (enable/disable)
 */
export default class NotesExtension {
    /**
     * Create the notes data directory if it doesn't exist
     * 
     * @private
     */
    _createDirectory() {
        try {
            // Ensure the directory exists with proper permissions
            if (!GLib.file_test(PATH, GLib.FileTest.EXISTS)) {
                GLib.mkdir_with_parents(PATH, 0o755);
            } else if (!GLib.file_test(PATH, GLib.FileTest.IS_DIR)) {
                log('Notes Extension: Path exists but is not a directory: ' + PATH);
            }
        } catch (e) {
            log('Notes Extension: Error creating directory: ' + e);
        }
    }

    /**
     * Enable the extension
     * 
     * Called when the extension is enabled by the user or at startup.
     */
    enable() {
        this._createDirectory();
        this._notesManager = new NotesManager(this);
    }

    /**
     * Disable the extension
     * 
     * Called when the extension is disabled by the user or at shutdown.
     */
    disable() {
        this._notesManager.destroy();
        this._notesManager = null;
    }
}

/**
 * NotesManager class
 * 
 * This class manages the creation, display, and interaction of sticky notes.
 * It handles the panel button, keyboard shortcuts, and note lifecycle.
 */
class NotesManager {
    /**
     * Initialize the NotesManager
     * 
     * @param {NotesExtension} extension - Extension object
     */
    constructor(extension) {
        this._extension = extension;
        this._allNotes = [];
        this._notesAreVisible = false;
        this._notesLoaded = false;
        this._layerId = 'on-background';
        
        // Initialize UI components
        this._initButton();
        
        // Automatically load and show notes when extension is enabled
        this._loadAllNotes();
        this._showNotes();
        log('Notes Extension: Automatically showing notes on startup');
    }

    /**
     * Initialize the panel button with icon
     * 
     * Creates a button in the top panel with a document icon
     * that toggles the visibility of notes when clicked.
     */
    _initButton() {
        this.panel_button = new PanelMenu.Button(0.0, "Show notes");
        const icon = new St.Icon({
            style_class: 'system-status-icon',
            icon_name: 'document-edit-symbolic'
        });
        this.panel_button.add_child(icon);
        this.panel_button.connect('button-press-event', this._onButtonPressed.bind(this));
        Main.panel.addToStatusArea('NotesButton', this.panel_button);
    }

    /**
     * Load all saved notes from storage
     * 
     * Scans the notes data directory for existing notes and loads them.
     * Creates a default note if no notes are found.
     */
    _loadAllNotes() {
        let i = 0;
        let notesFound = false;
        
        // Try to load existing notes
        while (true) {
            const stateFile = GLib.build_filenamev([PATH, `${i}_state`]);
            if (GLib.file_test(stateFile, GLib.FileTest.EXISTS)) {
                this.createNote('', 16);
                notesFound = true;
            } else {
                break;
            }
            i++;
        }
        
        // If no notes were found, create a default note
        if (!notesFound) {
            log('Notes Extension: No existing notes found, creating a default note');
            this.createNote('', 16);
        }
        
        this._notesLoaded = true;
    }

    /**
     * Create a new note with specified color and font size
     * 
     * @param {string} colorString - Color string for the note (RGB format)
     * @param {number} fontSize - Font size for the note
     * @returns {NoteBox.NoteBox} - The created note object
     */
    createNote(colorString, fontSize) {
        const nextId = this._allNotes.length;
        try {
            const note = new NoteBox.NoteBox(nextId, colorString, fontSize, this._extension, this);
            this._allNotes.push(note);
            return note;
        } catch (e) {
            Main.notify("Notes extension error: failed to load a note");
            log(`Failed to create note n°${nextId}: ${e}`);
            throw e;
        }
    }

    /**
     * Handle post-deletion cleanup and renumbering
     * 
     * After a note is deleted, this method handles renumbering the remaining notes
     * and cleaning up the files for the deleted note.
     * 
     * @param {number} deletedNoteId - ID of the deleted note
     */
    postDelete(deletedNoteId) {
        // Log for debugging
        log(`Notes Extension: Deleting note with ID ${deletedNoteId}, total notes: ${this._allNotes.length}`);
        
        // Always delete the files for the deleted note ID
        this._deleteNoteFiles(deletedNoteId);
        
        // If this was the last note in the array, we're done
        if (deletedNoteId >= this._allNotes.length) {
            return;
        }
        
        // Get the last note
        const lastNote = this._allNotes.pop();
        const lastNoteId = this._allNotes.length;
        
        // If the deleted note wasn't the last one, move the last note to the deleted position
        if (deletedNoteId < this._allNotes.length) {
            // Update the ID of the moved note
            lastNote.id = deletedNoteId;
            this._allNotes[deletedNoteId] = lastNote;
            
            // Save the note with its new ID
            this._allNotes[deletedNoteId].onlySave();
            
            log(`Notes Extension: Moved note from position ${lastNoteId} to ${deletedNoteId}`);
            
            // Delete the files for the old position
            this._deleteNoteFiles(lastNoteId);
        }
    }

    /**
     * Check if coordinates are usable for a new note
     * 
     * Ensures new notes don't overlap with existing ones.
     * 
     * @param {number} x - X coordinate
     * @param {number} y - Y coordinate
     * @returns {boolean} - Whether the coordinates are usable
     */
    areCoordsUsable(x, y) {
        return !this._allNotes.some(note => 
            Math.abs(note._x - x) < 230 && Math.abs(note._y - y) < 100
        );
    }

    /**
     * Show all notes
     * 
     * Makes all notes visible on the desktop.
     */
    _showNotes() {
        this._notesAreVisible = true;
        this._allNotes.forEach(note => note.show());
    }

    /**
     * Hide notes and save their state
     * 
     * Hides all notes and schedules a save operation.
     */
    _hideNotes() {
        this._notesAreVisible = false;
        this._allNotes.forEach(note => {
            note.actor.hide();
        });
        this._timeout_id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._allNotes.forEach(note => {
                note.removeFromCorrectLayer();
            });
            this._timeout_id = null;
        });
    }

    /**
     * Only hide notes without saving
     * 
     * Hides all notes without saving their state.
     */
    _onlyHideNotes() {
        this._allNotes.forEach(note => note.onlyHide());
        this._notesAreVisible = false;
    }

    /**
     * Delete note files for a specific ID
     * 
     * Removes the text and state files for a note.
     * 
     * @param {number} id - Note ID
     */
    _deleteNoteFiles(id) {
        try {
            const filePathBase = GLib.build_filenamev([PATH, id.toString()]);
            const textFilePath = `${filePathBase}_text`;
            const stateFilePath = `${filePathBase}_state`;
            
            // Create file objects using the correct Gio method
            const textFile = Gio.File.new_for_path(textFilePath);
            const stateFile = Gio.File.new_for_path(stateFilePath);
            
            // Delete the files if they exist
            if (GLib.file_test(textFilePath, GLib.FileTest.EXISTS)) {
            textFile.delete(null);
                log(`Notes Extension: Deleted text file: ${textFilePath}`);
            }
            
            if (GLib.file_test(stateFilePath, GLib.FileTest.EXISTS)) {
            stateFile.delete(null);
                log(`Notes Extension: Deleted state file: ${stateFilePath}`);
            }
        } catch (e) {
            log(`Notes Extension: Error deleting note files: ${e}`);
        }
    }

    /**
     * Handle button press event
     * 
     * Toggles the visibility of notes when the panel button is clicked.
     * 
     * @returns {boolean} - Whether the event was handled
     */
    _onButtonPressed() {
        if (!this._notesLoaded) {
            this._loadAllNotes();
        }

        // We've disabled layer cycling - notes are always on background
        // If needed, reload notes into the correct layer
        this._allNotes.forEach(note => {
            note.removeFromCorrectLayer();
            note.loadIntoCorrectLayer();
        });

        if (this._allNotes.length === 0) {
            this.createNote('', 16);
            this._showNotes();
        } else if (this._notesAreVisible) {
            this._hideNotes();
        } else {
            this._showNotes();
        }
    }

    /**
     * Clean up resources when extension is disabled
     * 
     * Disconnects signals, saves notes, and removes UI elements.
     */
    destroy() {
        // Save and destroy all notes
        if (this._allNotes) {
        this._allNotes.forEach(note => {
                try {
                    if (note) {
            note.onlySave(false);
            note.destroy();
                    }
                } catch (e) {
                    log(`Notes Extension: Error destroying note: ${e}`);
                }
        });
            this._allNotes = [];
        }

        // Destroy panel button
        if (this.panel_button) {
            try {
        this.panel_button.destroy();
                this.panel_button = null;
            } catch (e) {
                log(`Notes Extension: Error destroying panel button: ${e}`);
            }
        }

        // Remove timeout
        if (this._timeout_id) {
            GLib.source_remove(this._timeout_id);
            this._timeout_id = null;
        }
        
        log('Notes Extension: Successfully destroyed');
    }
}
