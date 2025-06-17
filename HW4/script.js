/*
File: script.js

Sources used:

HW3:
https://www.w3schools.com/js/js_htmldom_html.asp
https://www.w3schools.com/jsref/met_table_insertrow.asp
https://www.w3schools.com/jsref/jsref_parseint.asp

HW4: 
no sources were needed, as I only removed the calidation function and
moved some things to changeTable()

*/


//This function takes the inputted 4 values and changes an html table to 
//have axes bounded by the 4 values (h1 and h2 for horizontal and v1 and v2 
//for vertical)
function changeTable() {

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
