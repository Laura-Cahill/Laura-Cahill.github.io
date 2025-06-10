/*
File: hw3.html
GUI Assignment: Creating an Interactive Dynamic Table
Laura Cahill, UMass Lowell Computer Science, laura_cahill@student.uml.edu
Copyright (c) 2025 by Laura. All rights reserved. May be freely copied or
excerpted for educational purposes with credit to the author.
updated by LC on June 10, 2025 at 4:40 PM

This page can be used to dynamically create a multiplication table from
user inputed access bounds.

Sources used:
https://www.w3schools.com/js/js_htmldom_html.asp
https://www.w3schools.com/jsref/met_table_insertrow.asp
https://www.w3schools.com/jsref/jsref_parseint.asp

*/

//This function is called when the user inputs their numbers and hits the
//button. It validates their input, and if valid, calls the function to
//generate the table. It does not need to validate if the input is a number
//or out of range, as that is done by the html, but it does need to check
//if there was any input at all, or if the lower bounds are higher than the
//upper bounds
function validateForm() {

  document.getElementById("p1").innerHTML = "New text!";

  let h1 = document.forms["myForm"]["h1"].value;
  let h2 = document.forms["myForm"]["h2"].value;
  let v1 = document.forms["myForm"]["v1"].value;
  let v2 = document.forms["myForm"]["v2"].value;

  //Apparently my number values weren't clean integers because this code
  //was having trouble with 2 digit numbers until I added these lines
  h1 = parseInt(h1);
  h2 = parseInt(h2); 
  v1 = parseInt(v1);
  v2 = parseInt(v2); 

  if (h1 == "" || h2 == "" || v1 == "" || v2 == "" ) {
    document.getElementById("p1").innerHTML = "No number entered!";
   
  }
  else if (h1 > h2 || v1 > v2 ){
    document.getElementById("p1").innerHTML = "Minimums must be smaller than Maximums!";
  }
  else {
    document.getElementById("p1").innerHTML = "";
    changeTable(h1, h2, v1, v2);
  }
 
  return false;
} 

//This function takes 4 values and changes an html table to have axes
//bounded by the 4 values (h1 and h2 for horizontal and v1 and v2 for\
//vertical)
function changeTable(h1, h2, v1, v2) {


  var table = document.getElementById("table");
  var row;
  var td;
  var l = 1;
  var row;
  var cell;
  table.innerHTML = "";

  row = table.insertRow(0);
  cell = row.insertCell(0);

  //creates blank upper left cell
  cell.innerHTML = '';
  //creates first row, labeling horizontal axis
  for (i = h1; i <= h2; i++) {
    cell = row.insertCell();
    cell.innerHTML = i;
  }
  //creates rest of table
  for (i = v1; i <= v2; i++) {  
    //vertical axis label
    row = table.insertRow();
    cell = row.insertCell(0);
    cell.innerHTML = i;

    //calculates rest of the row based on row multiplied by column
   for (j = h1; j <= h2; j++) {
      cell = row.insertCell(l);
      cell.innerHTML = i * j;
      l++;
    } 
    l = 1;
  }
  return false;
}
