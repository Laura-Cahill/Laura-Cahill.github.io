/* File: script.js
GUI Assignment: Implementing a Bit of Scrabble with Drag-and-Drop
Laura Cahill, UMass Lowell Computer Science, laura_cahill@student.uml.edu
Copyright (c) 2025 by Laura. All rights reserved. May be freely copied or
excerpted for educational purposes with credit to the author.
updated by LC on June 30, 2025 at 5:27 PM

This page has an interactive one-line scrabble game, which counts up the score
and can be reset whenever the user wishes.

Sources used:
https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math
https://www.w3schools.com/jquery/event_ready.asp
https://api.jquery.com/each/
learn.jquery.com/using-jquery-core/jquery-object/
https://jqueryui.com/droppable/
https://api.jqueryui.com/droppable/
https://www.geeksforgeeks.org/jquery-ui-draggable-and-droppable-methods/

*/

//letter values for scoring
let letterValues = {
    'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2, 'H': 4,
    'I': 1, 'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1, 'P': 3,
    'Q': 10, 'R': 1, 'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4, 'X': 8,
    'Y': 4, 'Z': 10
};

//variables so the code knows whats going on in the game
let totalScore = 0;
let placedTiles = [];

function initializeBoard() {

    //for each board space
    $('.board-space').each(function(index) {

        //make things be able to be dropped in it
        $(this).attr('data-position', index).droppable({

            //when letter dropped on this board space:
            drop: function(event, ui) {

                //save this board space's position and new tile to variables
                let position = parseInt($(this).attr('data-position'));
                let droppedTile = ui.draggable;
                
                //get letter and remove old one
                let letter = droppedTile.attr('data-letter');
                droppedTile.remove();
                
                //create new tile
                let newTile = document.createElement('div');
                newTile.className = 'scrabble-tile locked-tile';
                newTile.style.backgroundImage = 'url("./graphics_data/Scrabble_Tiles/Scrabble_Tile_' + letter + '.jpg")';
                newTile.setAttribute('data-letter', letter);
                newTile.setAttribute('data-value', letterValues[letter]);
                
                //add to the board space
                this.appendChild(newTile);

                //add it to our list of tiles and update what spaces we can put tiles in and score
                placedTiles.push(position);
                updateDroppableSpaces();
                updateScore();
            }
        });
    });
}

function drawTiles() {

    //calculate how many tiles to add
    let rack = $('#tile-rack');
    let currentTiles = rack.children().length;
    let needed = 7 - currentTiles;
    
    //at them
    for (let i = 0; i < needed; i++) {
        let random = getRandomLetter();
        createTile(random);
    }

}

//picks a random letter using the scrabble distribution
function getRandomLetter() {

    const rand = Math.random();

    if (rand < 12/98) return 'E';
    if (rand < 21/98) return 'A';
    if (rand < 30/98) return 'I';
    if (rand < 38/98) return 'O';
    if (rand < 44/98) return 'N';
    if (rand < 50/98) return 'R';
    if (rand < 56/98) return 'T';
    if (rand < 60/98) return 'L';
    if (rand < 64/98) return 'S';
    if (rand < 68/98) return 'U';
    if (rand < 72/98) return 'D';
    if (rand < 75/98) return 'G';
    if (rand < 77/98) return 'B';
    if (rand < 79/98) return 'C';
    if (rand < 81/98) return 'M';
    if (rand < 83/98) return 'P';
    if (rand < 85/98) return 'F';
    if (rand < 87/98) return 'H';
    if (rand < 89/98) return 'V';
    if (rand < 91/98) return 'W';
    if (rand < 93/98) return 'Y';
    if (rand < 94/98) return 'K';
    if (rand < 95/98) return 'J';
    if (rand < 96/98) return 'X';
    if (rand < 97/98) return 'Q';
    return 'Z';

}

//creates and adds a tile to the rack
function createTile(letter) {

    //creates a div element to become a tile on the rack
    let tile = document.createElement('div');
    tile.className = 'scrabble-tile';

    //makes it the correct letter
    tile.style.backgroundImage = 'url("./graphics_data/Scrabble_Tiles/Scrabble_Tile_' + letter + '.jpg")';
    tile.setAttribute('data-letter', letter);
    tile.setAttribute('data-value', letterValues[letter]);
    
    //makes it draggable
    $(tile).draggable({
        revert: 'invalid',
        cursor: 'move'
    });
    
    //adds it
    $('#tile-rack').append(tile);

}


function calculateWordScore() {

    //starts at nothing
    let wordScore = 0;
    let wordMultiplier = 1;
    
    //for each board that has a tile:
    $(".board-space .locked-tile").each(function() {

        //get it's letter score and placement
        let letter = $(this).attr("data-letter");
        let letterValue = letterValues[letter];
        let parentSpace = $(this).parent();

        //if placement is double letter score, make letter value double
        if (parentSpace.hasClass("double-letter")) {
            letterValue *= 2;
        }
        //if placement is double word score, make word value double
        if (parentSpace.hasClass("double-word")) {
            wordMultiplier *= 2;
        }
        
        wordScore += letterValue;
    });
    
    return wordScore * wordMultiplier;
}

//runs every time a tile is dropped on the board
function updateScore() {
    //changes the score to be the current total plus new word
    $('#current-score').text(totalScore + calculateWordScore());
}


//this function makes it so you cant drop tiles not next to an existing tile
//unless the board is empty
function updateDroppableSpaces() {

    //for each space on the board
    $('.board-space').each(function() {

        //get where it is and if it's emoty
        let position = parseInt($(this).attr('data-position'));
        let empty = $(this).children().length === 0;
        
        //if board is empty, let it be dropped there
        if (placedTiles.length === 0) {
            $(this).droppable('enable');
        } 

        //check if space is empty and if it is:
        else if (empty) {

            //consider non droppable by default
            $(this).droppable('disable');

            //check each placed tile to see if it's next to this space
            for (let i = 0; i < placedTiles.length; i++) {

                //if this tile is next to this spot, allow dropping
                if ((placedTiles[i] - position) == 1 || (placedTiles[i] - position) == -1) {
                    $(this).droppable('enable');
                    break; //stop checking if we found one
                }
            }
        } else {
             //if the tile isn't empty, dont let things be dropped into it
            $(this).droppable('disable');
        }
    });

}

//when the page loads, set up the game
$(document).ready(function() {

    //create board and tiles
    initializeBoard();
    drawTiles();

    //set up button functions
    $('#draw-tiles').on('click', function() {
        let wordScore = calculateWordScore();
        totalScore += wordScore;
        $('#current-score').text(totalScore);
        
        $('.board-space').empty();
        placedTiles.length = 0;
        drawTiles();
        updateDroppableSpaces();
    });
    
    $('#reset-game').on('click', function() {
        totalScore = 0;
        placedTiles.length = 0;
        $('.board-space').empty();
        $('#tile-rack').empty();
        $('#current-score').text('0');
        drawTiles();
        updateDroppableSpaces();
    });
});

